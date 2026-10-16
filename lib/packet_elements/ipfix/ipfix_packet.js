var IpfixHeader = require("./ipfix_header");
var TemplateRecord = require("../flow_set_elements/template_set_ipfix/record");
var OptionsTemplateRecord = require("../flow_set_elements/options_template_set_ipfix/record");
var DataSetRecord = require("../flow_set_elements/data_set/record");
var SKIP_REASONS = require("../skip_reasons");
var Sets = require("../sets");

var IpfixPacket = function (params)
{
    var self = this;
    var buffer = params.buffer;
    var cachedTemplates = params.templates;
    var templateProvider = params.templateProvider;
    var onNewTemplate = params.onNewTemplate;
    var onTemplateWithdrawal = params.onTemplateWithdrawal;
    var useInternalStorage = params.useInternalStorage;
    this.Header = undefined;
    this.DataSets = [];
    this.TemplateSets = [];
    this.OptionsTemplateSets = [];
    this.TemplateWithdrawals = [];
    this.SkippedSets = [];
    var _construct = function (buffer)
    {
        self.Header = new IpfixHeader(buffer);
        Sets.walkSets(buffer.slice(self.Header.sizeInBytes), self.SkippedSets, function (setId, setDataLength, body)
        {
            var setType = getSetType(setId);
            if (setType == "DataTemplate")
                readTemplateSet(setId, setDataLength, body);
            else if (setType == "OptionTemplate")
                readOptionsTemplateSet(setId, setDataLength, body);
            else if (setType == "DataSet")
                readDataSet(setId, setDataLength, body);
            else
                self.SkippedSets.push({ setId: setId, reason: SKIP_REASONS.UNKNOWN_SET });
        });
    };
    // A template record of no field is a withdrawal (RFC 7011 section 8.1); one whose id is the set id withdraws every
    // template of the set's kind
    var isWithdrawn = function (templateId, setId)
    {
        return templateId === setId || templateId > 255;
    };
    var readTemplateSet = function (setId, setDataLength, body)
    {
        var index = 0;
        // The set may end with padding, shorter than a record header
        while (setDataLength - index >= Sets.TEMPLATE_RECORD_HEADER_SIZE) {
            var template = new TemplateRecord(body.slice(index, setDataLength));
            index += template.sizeInBytes;
            if (template.numberFields === 0) {
                if (isWithdrawn(template.templateId, setId))
                    withdrawTemplate(template.templateId, "DataTemplate");
            } else if (template.templateId > 255 && storeTemplate(template, setId)) {
                self.TemplateSets.push(template);
            }
        }
    };
    var readOptionsTemplateSet = function (setId, setDataLength, body)
    {
        var index = 0;
        while (setDataLength - index >= Sets.TEMPLATE_RECORD_HEADER_SIZE) {
            // A withdrawal has no scope field count: its record is the template id and a field count of 0
            if (body.readUInt16BE(index + 2) === 0) {
                var templateId = body.readUInt16BE(index);
                index += Sets.TEMPLATE_RECORD_HEADER_SIZE;
                if (isWithdrawn(templateId, setId))
                    withdrawTemplate(templateId, "OptionsTemplate");

                continue;
            }

            var template = new OptionsTemplateRecord(body.slice(index, setDataLength));
            index += template.sizeInBytes;
            if (template.templateId > 255 && storeTemplate(template, setId))
                self.OptionsTemplateSets.push(template);
        }
    };
    var readDataSet = function (setId, setDataLength, body)
    {
        // A provider may return null for an id it does not know. The records are framed by the template's fields, not
        // by dataRecordSizeInBytes, which a caller's own template may lack: a record of no byte is caught below.
        var template = templateOf(setId);
        if (template == null)
            return;

        try {
            var index = 0;
            while (index < setDataLength) {
                var recordLength = recordLengthAt(template, body, index);
                if (!(recordLength > 0)) {
                    // index would never move: the rest of the set is left
                    self.SkippedSets.push({ setId: setId, templateId: template.templateId, reason: SKIP_REASONS.EMPTY_RECORD });
                    break;
                }

                if (index + recordLength > setDataLength) {
                    // If record length exceeds remaining data, break out of the loop
                    console.warn(
                        `Incomplete record detected in data set with template ID ${template.templateId} index:${index}, recordLength:${recordLength}, setDataLength:${setDataLength}`
                    );
                    break;
                }

                var flow = new DataSetRecord(body.slice(index, index + recordLength), {
                    template: template,
                    parseDataValues: params.parseDataValues,
                });
                index += recordLength;
                flow.templateId = template.templateId;
                self.DataSets.push(flow);
            }
        } catch (e) {
            console.error(e);
            console.error(`Couldn't deserialize template with id ${setId}`);
            console.error(`Template with id ${setId} has invalid structure !`);
        }
    };
    // The length of the record at index: its fixed-length fields, and for each variable-length field the length its
    // prefix gives (RFC 7011 section 7), in 1 byte, or 255 then 2 bytes
    var recordLengthAt = function (template, body, index)
    {
        var recordLength = 0;
        for (const field of template.FieldSpecifiers) {
            if (field.fieldLength === Sets.VARIABLE_LENGTH) {
                var length = body.readUInt8(index + recordLength);
                if (length === 255)
                    recordLength += body.readUInt16BE(index + recordLength + 1) + 3;
                else
                    recordLength += length + 1;
            } else {
                recordLength += field.fieldLength;
            }
        }

        return recordLength;
    };
    var templateOf = function (templateId)
    {
        if (!useInternalStorage) {
            if (typeof templateProvider === "function")
                return templateProvider(templateId);

            throw new Error("Please provide a templateProvider function or set useInternalStorage to true !");
        }

        if (typeof cachedTemplates == "undefined")
            throw new Error("Please provide a templateProvider function or set useInternalStorage to true !");

        if (cachedTemplates.DataTemplateMap.has(templateId))
            return cachedTemplates.DataTemplateMap.get(templateId);

        if (cachedTemplates.OptionsTemplateMap.has(templateId))
            return cachedTemplates.OptionsTemplateMap.get(templateId);

        console.error(`Couldn't deserialize template with id ${templateId}`);
        console.error(`Missing template with id ${templateId} in local storage ! `);
        return undefined;
    };
    // Stores or passes on a template whose records can be read, and says whether it did
    var storeTemplate = function (template, setId)
    {
        if (!Sets.isUsableTemplate(template)) {
            self.SkippedSets.push({ setId: setId, templateId: template.templateId, reason: SKIP_REASONS.EMPTY_RECORD });
            return false;
        }

        var templateType = undefined;
        if (template instanceof OptionsTemplateRecord)
            templateType = "OptionsTemplate";
        else if (template instanceof TemplateRecord) templateType = "DataTemplate";
        if (useInternalStorage) {
            if (templateType == "OptionsTemplate")
                cachedTemplates.OptionsTemplateMap.set(template.templateId, template);
            else if (templateType == "DataTemplate")
                cachedTemplates.DataTemplateMap.set(template.templateId, template);
        } else {
            if (typeof onNewTemplate != "undefined")
                onNewTemplate.call(self, template, templateType);
            else
                console.error(
                    `Please provde a 'onNewTemplate' option so we can keep you updated with templates, otherwise set 'useInternalStorage' to true so i can do all the work by myself.`
                );
        }

        return true;
    };
    // The exporter no longer uses the template (or, for a template id of 2 or 3, any template of the kind). The internal
    // storage keeps its templates: it is one per process, shared by every exporter, and an exporter announces a template
    // again before it sends data of its id. A caller that keeps templates per exporter is told through
    // onTemplateWithdrawal; an error it throws or a promise it rejects is noted on the withdrawal, not thrown.
    var withdrawTemplate = function (templateId, templateType)
    {
        var withdrawal = { templateId: templateId, templateType: templateType };
        self.TemplateWithdrawals.push(withdrawal);
        if (useInternalStorage || typeof onTemplateWithdrawal != "function")
            return;

        try {
            var result = onTemplateWithdrawal.call(self, templateId, templateType);
            if (result && typeof result.then == "function") {
                result.then(null, function (error)
                {
                    withdrawal.error = messageOf(error);
                });
            }
        } catch (error) {
            withdrawal.error = messageOf(error);
        }
    };
    var messageOf = function (error)
    {
        return error && error.message ? error.message : String(error);
    };
    var getSetType = function (setId)
    {
        if (setId == 2) return "DataTemplate";
        else if (setId == 3) return "OptionTemplate";
        else if (setId > 255) return "DataSet";
    };
    _construct(buffer);
    return this;
};

IpfixPacket.prototype.IpfixHeader = IpfixHeader;
module.exports = IpfixPacket;
