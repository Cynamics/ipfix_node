var IpfixHeader = require("./ipfix_header");
var TemplateRecord = require("../flow_set_elements/template_set_ipfix/record");
var OptionsTemplateRecord = require("../flow_set_elements/options_template_set_ipfix/record");
var DataSetRecord = require("../flow_set_elements/data_set/record");
var SKIP_REASONS = require("../skip_reasons");
var Sets = require("../sets");
var TemplateStore = require("../template_store");

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

// How a template frames its records, framed by its fields rather than by dataRecordSizeInBytes, which a caller's own
// template may lack: the shortest record it allows (its fixed-length fields, and the 1-byte prefix of each
// variable-length field), and the length of the record at an index of the set. A field length that is no byte count
// makes the shortest record NaN.
var framingOf = function (template, body)
{
    if (!Array.isArray(template.FieldSpecifiers))
        return { shortest: NaN };

    var shortest = 0;
    var variable = false;
    for (const field of template.FieldSpecifiers) {
        if (field.fieldLength === Sets.VARIABLE_LENGTH) {
            variable = true;
            shortest += 1;
        } else {
            shortest += Number.isInteger(field.fieldLength) && field.fieldLength >= 0 ? field.fieldLength : NaN;
        }
    }

    return {
        shortest: shortest,
        lengthAt: variable ? function (index) { return recordLengthAt(template, body, index); } : function () { return shortest; },
    };
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
        templates = new TemplateStore(params, self, self.Header.Version, self.Header.ObservationDomainId);
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
    var readTemplateSet = function (setId, setDataLength, body)
    {
        var index = 0;
        // The set may end with padding, shorter than a record header
        while (setDataLength - index >= Sets.TEMPLATE_RECORD_HEADER_SIZE) {
            var template = new TemplateRecord(body.slice(index, setDataLength));
            index += template.sizeInBytes;
            // A template record of no field is a withdrawal (RFC 7011 section 8.1)
            if (template.numberFields === 0)
                templates.withdraw(template.templateId, "DataTemplate", setId);
            else if (templates.store(template, "DataTemplate", setId))
                self.TemplateSets.push(template);
        }
    };
    var readOptionsTemplateSet = function (setId, setDataLength, body)
    {
        var index = 0;
        while (setDataLength - index >= Sets.TEMPLATE_RECORD_HEADER_SIZE) {
            // A withdrawal has no scope field count: its record is the template id and a field count of 0
            if (body.readUInt16BE(index + 2) === 0) {
                templates.withdraw(body.readUInt16BE(index), "OptionsTemplate", setId);
                index += Sets.TEMPLATE_RECORD_HEADER_SIZE;
                continue;
            }

            if (setDataLength - index < Sets.OPTIONS_TEMPLATE_HEADER_SIZE) {
                self.SkippedSets.push({ setId: setId, reason: SKIP_REASONS.RECORD_PAST_SET });
                break;
            }

            var template = new OptionsTemplateRecord(body.slice(index, setDataLength));
            index += template.sizeInBytes;
            if (templates.store(template, "OptionsTemplate", setId))
                self.OptionsTemplateSets.push(template);
        }
    };
    var readDataSet = function (setId, setDataLength, body)
    {
        var template = templates.get(setId);
        if (template == null) {
            self.SkippedSets.push({ setId: setId, templateId: setId, reason: SKIP_REASONS.UNKNOWN_TEMPLATE });
            return;
        }

        Sets.walkRecords(setId, template, setDataLength, framingOf(template, body), self.SkippedSets, function (index, length)
        {
            var flow = new DataSetRecord(body.slice(index, index + length), { template: template, parseDataValues: params.parseDataValues });
            flow.templateId = template.templateId;
            self.DataSets.push(flow);
        });
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
