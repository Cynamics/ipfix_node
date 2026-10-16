var IpfixHeader = require("./ipfix_header");
var TemplateRecord = require("../flow_set_elements/template_set_ipfix/record");
var OptionsTemplateRecord = require("../flow_set_elements/options_template_set_ipfix/record");
var DataSetRecord = require("../flow_set_elements/data_set/record");
var SKIP_REASONS = require("../skip_reasons");
var Sets = require("../sets");
var TemplateStore = require("../template_store");

// The length of a record of the template when none of its fields has a variable length, else null
var fixedRecordLength = function (template)
{
    var length = 0;
    for (const field of template.FieldSpecifiers) {
        if (field.fieldLength === Sets.VARIABLE_LENGTH)
            return null;

        length += Number(field.fieldLength);
    }

    return length;
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
            recordLength += Number(field.fieldLength);
        }
    }

    return recordLength;
};

// A template record of no field is a withdrawal (RFC 7011 section 8.1); one whose id is the set id withdraws every
// template of the set's kind
var isWithdrawal = function (templateId, setId)
{
    return templateId === setId || templateId > 255;
};

var IpfixPacket = function (params)
{
    var self = this;
    var buffer = params.buffer;
    var templates = undefined;
    this.Header = undefined;
    this.DataSets = [];
    this.TemplateSets = [];
    this.OptionsTemplateSets = [];
    this.TemplateWithdrawals = [];
    this.SkippedSets = [];
    var _construct = function (buffer)
    {
        self.Header = new IpfixHeader(buffer);
        templates = new TemplateStore(params, self, self.Header.ObservationDomainId);
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
    var readWithdrawal = function (templateId, templateType, setId)
    {
        if (isWithdrawal(templateId, setId))
            templates.withdraw(templateId, templateType, setId);
        else
            self.SkippedSets.push({ setId: setId, templateId: templateId, reason: SKIP_REASONS.RESERVED_WITHDRAWAL });
    };
    var readTemplateSet = function (setId, setDataLength, body)
    {
        var index = 0;
        // The set may end with padding, shorter than a record header
        while (setDataLength - index >= Sets.TEMPLATE_RECORD_HEADER_SIZE) {
            var template = new TemplateRecord(body.slice(index, setDataLength));
            index += template.sizeInBytes;
            if (template.numberFields === 0)
                readWithdrawal(template.templateId, "DataTemplate", setId);
            else if (template.templateId > 255 && templates.store(template, "DataTemplate", setId))
                self.TemplateSets.push(template);
        }
    };
    var readOptionsTemplateSet = function (setId, setDataLength, body)
    {
        var index = 0;
        while (setDataLength - index >= Sets.TEMPLATE_RECORD_HEADER_SIZE) {
            // A withdrawal has no scope field count: its record is the template id and a field count of 0
            if (body.readUInt16BE(index + 2) === 0) {
                readWithdrawal(body.readUInt16BE(index), "OptionsTemplate", setId);
                index += Sets.TEMPLATE_RECORD_HEADER_SIZE;
                continue;
            }

            if (setDataLength - index < Sets.OPTIONS_TEMPLATE_HEADER_SIZE) {
                self.SkippedSets.push({ setId: setId, reason: SKIP_REASONS.RECORD_PAST_SET });
                break;
            }

            var template = new OptionsTemplateRecord(body.slice(index, setDataLength));
            index += template.sizeInBytes;
            if (template.templateId > 255 && templates.store(template, "OptionsTemplate", setId))
                self.OptionsTemplateSets.push(template);
        }
    };
    var readDataSet = function (setId, setDataLength, body)
    {
        // The records are framed by the template's fields, not by dataRecordSizeInBytes, which a caller's own template
        // may lack: a record length that is no positive number is caught below
        var template = templates.get(setId);
        if (template == null)
            return;

        try {
            var fixedLength = fixedRecordLength(template);
            var index = 0;
            while (index < setDataLength) {
                var recordLength = fixedLength !== null ? fixedLength : recordLengthAt(template, body, index);
                if (!(recordLength > 0)) {
                    // index would never move: the rest of the set is left
                    var reason = Number.isNaN(recordLength) ? SKIP_REASONS.MALFORMED_TEMPLATE : SKIP_REASONS.EMPTY_RECORD;
                    self.SkippedSets.push({ setId: setId, templateId: template.templateId, reason: reason });
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
