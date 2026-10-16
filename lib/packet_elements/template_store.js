var Sets = require("./sets");

var messageOf = function (error)
{
    return error && error.message ? error.message : String(error);
};

/**
 * The templates a packet reads and writes, for both parsers: the internal storage, scoped by observation domain (the
 * IPFIX Observation Domain ID, the NetFlow v9 Source ID) as RFC 7011 and RFC 3954 scope templates, or the caller's own
 * through templateProvider, onNewTemplate and onTemplateWithdrawal.
 *
 * @param params - the deserializer's parameters: useInternalStorage, templates (the internal storage),
 * templateProvider, onNewTemplate, onTemplateWithdrawal
 * @param packet - the packet being read: its SkippedSets and TemplateWithdrawals are filled, and it is `this` in the
 * callbacks
 * @param domainId - the packet's observation domain
 */
var TemplateStore = function (params, packet, domainId)
{
    var storage = params.templates;
    var keyOf = function (templateId)
    {
        return domainId + ":" + templateId;
    };
    var mapOf = function (templateType)
    {
        return templateType == "OptionsTemplate" ? storage.OptionsTemplateMap : storage.DataTemplateMap;
    };

    // The template of a data set's id: undefined when unknown, and a provider may also return null
    this.get = function (templateId)
    {
        if (!params.useInternalStorage) {
            if (typeof params.templateProvider === "function")
                return params.templateProvider(templateId);

            throw new Error("Please provide a templateProvider function or set useInternalStorage to true !");
        }

        if (typeof storage == "undefined")
            throw new Error("Please provide a templateProvider function or set useInternalStorage to true !");

        var key = keyOf(templateId);
        if (storage.DataTemplateMap.has(key))
            return storage.DataTemplateMap.get(key);

        if (storage.OptionsTemplateMap.has(key))
            return storage.OptionsTemplateMap.get(key);

        console.error(`Couldn't deserialize template with id ${templateId}`);
        console.error(`Missing template with id ${templateId} in local storage ! `);
        return undefined;
    };

    // Stores or passes on a template whose records can be read, and says whether it did
    this.store = function (template, templateType, setId)
    {
        var reason = Sets.unusableReason(template);
        if (reason) {
            packet.SkippedSets.push({ setId: setId, templateId: template.templateId, reason: reason });
            return false;
        }

        if (params.useInternalStorage)
            mapOf(templateType).set(keyOf(template.templateId), template);
        else if (typeof params.onNewTemplate != "undefined")
            params.onNewTemplate.call(packet, template, templateType);
        else
            console.error(
                `Please provde a 'onNewTemplate' option so we can keep you updated with templates, otherwise set 'useInternalStorage' to true so i can do all the work by myself.`
            );

        return true;
    };

    /**
     * An IPFIX template withdrawal (RFC 7011 section 8.1): the exporter no longer uses the template, or, for the set id
     * as template id (2, 3), any template of the kind. The internal storage removes it from the packet's domain. A
     * caller keeping its own templates is told through onTemplateWithdrawal: an error it throws, or a promise it
     * rejects, is noted as error on the withdrawal, whose settled promise resolves once the callback is done.
     */
    this.withdraw = function (templateId, templateType, setId)
    {
        var withdrawal = { templateId: templateId, templateType: templateType };
        var settled = Promise.resolve();
        packet.TemplateWithdrawals.push(withdrawal);
        if (params.useInternalStorage) {
            var map = mapOf(templateType);
            if (templateId === setId) {
                var prefix = domainId + ":";
                for (const key of [...map.keys()]) {
                    if (String(key).startsWith(prefix))
                        map.delete(key);
                }
            } else {
                map.delete(keyOf(templateId));
            }
        } else if (typeof params.onTemplateWithdrawal == "function") {
            try {
                var result = params.onTemplateWithdrawal.call(packet, templateId, templateType);
                if (result && typeof result.then == "function") {
                    settled = Promise.resolve(result).then(function () {}, function (error)
                    {
                        withdrawal.error = messageOf(error);
                    });
                }
            } catch (error) {
                withdrawal.error = messageOf(error);
            }
        }

        // Not enumerable: the withdrawal stays a plain record to copy, compare or log
        Object.defineProperty(withdrawal, "settled", { value: settled });
    };
};

module.exports = TemplateStore;
