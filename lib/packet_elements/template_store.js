var Sets = require("./sets");
var SKIP_REASONS = require("./skip_reasons");

// The transports over which a template withdrawal is honored: a collector over UDP MUST ignore it (RFC 7011 section 8.4)
var WITHDRAWING_TRANSPORTS = ["tcp", "sctp"];

var messageOf = function (error)
{
    return error && error.message ? error.message : String(error);
};

// Not enumerable: the record stays a plain one to copy, compare or log. A record the caller froze gets none.
var settle = function (record, settled)
{
    if (Object.isExtensible(record))
        Object.defineProperty(record, "settled", { value: settled });
};

// An options template has a scope field count, a template has none: so are they told apart once a caller stored them
var kindOf = function (template)
{
    return template.scopeFieldCount !== undefined ? "OptionsTemplate" : "DataTemplate";
};

// The part of a storage key before its version, domain and template id: the session, "" for messages given none
var sessionOf = function (key)
{
    return key.split("/").slice(0, -3).join("/");
};

/**
 * The templates a packet reads and writes, for both parsers: the internal storage, or the caller's own through
 * templateProvider, onNewTemplate and onTemplateWithdrawal, each called with the packet as `this`.
 *
 * The internal storage scopes templates as RFC 7011 and RFC 3954 do, by transport session (the session the caller gives
 * deserialize, if any) and observation domain (the IPFIX Observation Domain ID, the NetFlow v9 Source ID), and keeps
 * each protocol version's apart: its maps are keyed `[<session>/]<version>/<domainId>/<templateId>`.
 *
 * With the caller's own storage, a template or withdrawal stays pending until its callback has settled: the message's
 * later sets and the deserializer's next messages read it before the templateProvider, in the order the exporter sent
 * them (RFC 7011 section 8.1), as the callback may store or remove it only later.
 *
 * @param params - the deserializer's parameters: useInternalStorage, templates (the internal storage), pending (the
 * deserializer's pending templates and withdrawals), transport, session, templateProvider, onNewTemplate,
 * onTemplateWithdrawal
 * @param packet - the packet being read: its SkippedSets and TemplateWithdrawals are filled, and it is `this` in the
 * callbacks
 * @param version - the packet's protocol version, 9 or 10
 * @param domainId - the packet's observation domain
 */
var TemplateStore = function (params, packet, version, domainId)
{
    var storage = params.templates;
    var session = params.session == null ? "" : String(params.session);
    var scope = (session ? session + "/" : "") + version + "/" + domainId + "/";
    // Keyed as the internal storage is: a template or withdrawal is { template } (null once withdrawn), a withdrawal of
    // all templates of a kind { } under the kind's key. Each entry has a settled promise.
    var pending = params.pending || new Map();
    var keyOf = function (templateId)
    {
        return scope + templateId;
    };
    var allKeyOf = function (templateType)
    {
        return scope + "*" + templateType;
    };
    // The scope of a key is all of it up to the template id, which holds no "/" (a session may)
    var scopeOf = function (key)
    {
        return key.slice(0, key.lastIndexOf("/") + 1);
    };
    var mapOf = function (templateType)
    {
        return templateType == "OptionsTemplate" ? storage.OptionsTemplateMap : storage.DataTemplateMap;
    };
    var otherMapOf = function (templateType)
    {
        return templateType == "OptionsTemplate" ? storage.DataTemplateMap : storage.OptionsTemplateMap;
    };
    var skip = function (entry)
    {
        packet.SkippedSets.push(entry);
    };

    // Holds an entry until its callback, and every callback held before it under its key, has settled
    var hold = function (key, entry, settled)
    {
        var previous = pending.get(key);
        entry.settled = previous ? Promise.all([settled, previous.settled]) : settled;
        pending.set(key, entry);
        entry.settled.then(function ()
        {
            if (pending.get(key) === entry)
                pending.delete(key);
        });
    };

    // Calls one of the caller's callbacks: an error it throws, or a promise it returns that rejects, is noted as error on
    // the record, whose settled promise resolves once the callback is done. Returns that promise.
    var notify = function (callback, args, record)
    {
        var settled = Promise.resolve();
        try {
            var result = callback.apply(packet, args);
            if (result && typeof result.then == "function") {
                settled = Promise.resolve(result).then(function () {}, function (error)
                {
                    record.error = messageOf(error);
                });
            }
        } catch (error) {
            record.error = messageOf(error);
        }

        settle(record, settled);
        return settled;
    };

    // The template of an id: { template }, undefined when unknown (a provider may also return null), or { error } when
    // the provider threw
    var lookup = function (templateId)
    {
        if (!params.useInternalStorage) {
            var held = pending.get(keyOf(templateId));
            if (held)
                return { template: held.template };

            try {
                var provided = params.templateProvider.call(packet, templateId);
            } catch (error) {
                return { error: messageOf(error) };
            }

            return { template: provided != null && pending.has(allKeyOf(kindOf(provided))) ? undefined : provided };
        }

        var key = keyOf(templateId);
        return { template: storage.DataTemplateMap.has(key) ? storage.DataTemplateMap.get(key) : storage.OptionsTemplateMap.get(key) };
    };

    // The template of a data set's id, or null when there is none to read it with, listed in SkippedSets
    this.forDataSet = function (setId)
    {
        var found = lookup(setId);
        if (found.template != null)
            return found.template;

        if (found.error)
            skip({ setId: setId, templateId: setId, reason: SKIP_REASONS.PROVIDER_ERROR, error: found.error });
        else
            skip({ setId: setId, templateId: setId, reason: SKIP_REASONS.UNKNOWN_TEMPLATE });

        return null;
    };

    /**
     * Stores or passes on a template whose records can be read, and says whether it did. A template id names one
     * template of its domain, a template or an options template (RFC 7011 section 3.4.1): one redefined with the other
     * kind replaces it. Each template stored or passed on has a settled promise, which resolves once onNewTemplate is
     * done; an error that callback throws, or a promise it returns that rejects, is noted as error on the template.
     */
    this.store = function (template, templateType, setId)
    {
        // Template ids 0 to 255 are reserved: no data set uses one (RFC 7011 section 3.4.1, RFC 3954 section 5.2)
        var reason = template.templateId > 255 ? Sets.unusableReason(template) : SKIP_REASONS.RESERVED_TEMPLATE;
        if (reason) {
            skip({ setId: setId, templateId: template.templateId, reason: reason });
            return false;
        }

        if (params.useInternalStorage) {
            var key = keyOf(template.templateId);
            otherMapOf(templateType).delete(key);
            mapOf(templateType).set(key, template);
            settle(template, Promise.resolve());
            return true;
        }

        // A withdrawal of all templates of the kind still pending is settled before the template counts as stored
        var settled = notify(params.onNewTemplate, [template, templateType], template);
        var all = pending.get(allKeyOf(templateType));
        hold(keyOf(template.templateId), { template: template }, all ? Promise.all([settled, all.settled]) : settled);
        return true;
    };

    /**
     * An IPFIX template withdrawal (RFC 7011 section 8.1): the exporter no longer uses the template, or, for the set id
     * as template id (2, 3), any template of the kind in the domain. Listed in SkippedSets and otherwise ignored: a
     * record of no field whose id is reserved and not the set id, a withdrawal received over UDP (section 8.4), and one of
     * a template of its kind there is not (section 8.1). The internal storage removes the template; a caller keeping its
     * own is told through onTemplateWithdrawal, and an error that callback throws or rejects with is noted as error on
     * the withdrawal, whose settled promise resolves once the callback is done.
     */
    this.withdraw = function (templateId, templateType, setId)
    {
        var all = templateId === setId;
        var found = null;
        var reason = null;
        if (!all && templateId <= 255)
            reason = SKIP_REASONS.RESERVED_WITHDRAWAL;
        else if (WITHDRAWING_TRANSPORTS.indexOf(params.transport) < 0)
            reason = SKIP_REASONS.WITHDRAWAL_OVER_UDP;
        else if (!all) {
            found = lookup(templateId);
            if (found.error)
                reason = SKIP_REASONS.PROVIDER_ERROR;
            else if (found.template == null || kindOf(found.template) !== templateType)
                reason = SKIP_REASONS.UNKNOWN_WITHDRAWAL;
        }

        if (reason) {
            var entry = { setId: setId, templateId: templateId, reason: reason };
            if (found && found.error)
                entry.error = found.error;

            skip(entry);
            return;
        }

        var withdrawal = { templateId: templateId, templateType: templateType };
        packet.TemplateWithdrawals.push(withdrawal);
        if (params.useInternalStorage) {
            var map = mapOf(templateType);
            if (all) {
                for (const key of [...map.keys()]) {
                    if (scopeOf(String(key)) === scope)
                        map.delete(key);
                }
            } else {
                map.delete(keyOf(templateId));
            }

            settle(withdrawal, Promise.resolve());
            return;
        }

        var settled = Promise.resolve();
        if (typeof params.onTemplateWithdrawal == "function")
            settled = notify(params.onTemplateWithdrawal, [templateId, templateType], withdrawal);
        else
            settle(withdrawal, settled);

        if (!all) {
            hold(keyOf(templateId), { template: null }, settled);
            return;
        }

        for (const [key, entry] of [...pending]) {
            if (entry.template && scopeOf(key) === scope && kindOf(entry.template) === templateType)
                hold(key, { template: null }, settled);
        }

        hold(allKeyOf(templateType), {}, settled);
    };
};

/**
 * Removes every template of a transport session from the internal storage, of both versions and every domain: the end
 * of a TCP connection or an SCTP association withdraws them all (RFC 7011 section 8.1). A session of null or "" is
 * that of the messages given none.
 */
TemplateStore.endSession = function (storage, session)
{
    var target = session == null ? "" : String(session);
    for (const map of [storage.DataTemplateMap, storage.OptionsTemplateMap]) {
        for (const key of [...map.keys()]) {
            if (sessionOf(String(key)) === target)
                map.delete(key);
        }
    }
};

module.exports = TemplateStore;
