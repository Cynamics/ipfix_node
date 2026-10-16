var Sets = require("./sets");
var SKIP_REASONS = require("./skip_reasons");

// The transports over which a template withdrawal is honored: a collector over UDP MUST ignore it (RFC 7011 section 8.4)
var WITHDRAWING_TRANSPORTS = ["tcp", "sctp"];

var messageOf = function (error)
{
    return error && error.message ? error.message : String(error);
};

// Not enumerable: the record stays a plain one to copy, compare or log
var settle = function (record, settled)
{
    Object.defineProperty(record, "settled", { value: settled });
};

/**
 * The templates a packet reads and writes, for both parsers: the internal storage, or the caller's own through
 * templateProvider, onNewTemplate and onTemplateWithdrawal, each called with the packet as `this`.
 *
 * The internal storage scopes templates as RFC 7011 and RFC 3954 do, by transport session (the session the caller gives
 * deserialize, if any) and observation domain (the IPFIX Observation Domain ID, the NetFlow v9 Source ID), and keeps
 * each protocol version's apart: its maps are keyed `[<session>/]<version>/<domainId>/<templateId>`.
 *
 * @param params - the deserializer's parameters: useInternalStorage, templates (the internal storage), transport,
 * session, templateProvider, onNewTemplate, onTemplateWithdrawal
 * @param packet - the packet being read: its SkippedSets and TemplateWithdrawals are filled, and it is `this` in the
 * callbacks
 * @param version - the packet's protocol version, 9 or 10
 * @param domainId - the packet's observation domain
 */
var TemplateStore = function (params, packet, version, domainId)
{
    var self = this;
    var storage = params.templates;
    var session = params.session == null ? "" : String(params.session);
    var scope = (session ? session + "/" : "") + version + "/" + domainId + "/";
    var keyOf = function (templateId)
    {
        return scope + templateId;
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
    var skip = function (setId, templateId, reason)
    {
        packet.SkippedSets.push({ setId: setId, templateId: templateId, reason: reason });
    };

    // Calls one of the caller's callbacks: an error it throws, or a promise it returns that rejects, is noted as error on
    // the record, whose settled promise resolves once the callback is done
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
    };

    // The template of a data set's id: undefined when unknown, and a provider may also return null
    this.get = function (templateId)
    {
        if (!params.useInternalStorage) {
            if (typeof params.templateProvider === "function")
                return params.templateProvider.call(packet, templateId);

            throw new Error("Please provide a templateProvider function or set useInternalStorage to true !");
        }

        if (typeof storage == "undefined")
            throw new Error("Please provide a templateProvider function or set useInternalStorage to true !");

        var key = keyOf(templateId);
        return storage.DataTemplateMap.has(key) ? storage.DataTemplateMap.get(key) : storage.OptionsTemplateMap.get(key);
    };

    // Whether a withdrawal names a template there is: one of its kind in the internal storage, or one the provider returns
    var has = function (templateId, templateType)
    {
        if (params.useInternalStorage)
            return typeof storage != "undefined" && mapOf(templateType).has(keyOf(templateId));

        return typeof params.templateProvider !== "function" || self.get(templateId) != null;
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
            skip(setId, template.templateId, reason);
            return false;
        }

        if (params.useInternalStorage) {
            var key = keyOf(template.templateId);
            otherMapOf(templateType).delete(key);
            mapOf(templateType).set(key, template);
            settle(template, Promise.resolve());
        } else if (typeof params.onNewTemplate == "function") {
            notify(params.onNewTemplate, [template, templateType], template);
        } else {
            console.error(
                `Please provde a 'onNewTemplate' option so we can keep you updated with templates, otherwise set 'useInternalStorage' to true so i can do all the work by myself.`
            );
            settle(template, Promise.resolve());
        }

        return true;
    };

    /**
     * An IPFIX template withdrawal (RFC 7011 section 8.1): the exporter no longer uses the template, or, for the set id
     * as template id (2, 3), any template of the kind in the domain. Listed in SkippedSets and otherwise ignored: a
     * record of no field whose id is reserved and not the set id, a withdrawal received over UDP (section 8.4), and one of
     * a template there is not (section 8.1). The internal storage removes the template; a caller keeping its own is told
     * through onTemplateWithdrawal, and an error that callback throws or rejects with is noted as error on the
     * withdrawal, whose settled promise resolves once the callback is done.
     */
    this.withdraw = function (templateId, templateType, setId)
    {
        var all = templateId === setId;
        var reason = null;
        if (!all && templateId <= 255)
            reason = SKIP_REASONS.RESERVED_WITHDRAWAL;
        else if (WITHDRAWING_TRANSPORTS.indexOf(String(params.transport).toLowerCase()) < 0)
            reason = SKIP_REASONS.WITHDRAWAL_OVER_UDP;
        else if (!all && !has(templateId, templateType))
            reason = SKIP_REASONS.UNKNOWN_WITHDRAWAL;

        if (reason) {
            skip(setId, templateId, reason);
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
        } else if (typeof params.onTemplateWithdrawal == "function") {
            notify(params.onTemplateWithdrawal, [templateId, templateType], withdrawal);
            return;
        }

        settle(withdrawal, Promise.resolve());
    };
};

module.exports = TemplateStore;
