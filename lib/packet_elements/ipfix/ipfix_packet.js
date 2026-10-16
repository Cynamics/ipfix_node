var IpfixHeader = require("./ipfix_header");
var TemplateRecord = require("../flow_set_elements/template_set_ipfix/record");
var OptionsTemplateRecord = require("../flow_set_elements/options_template_set_ipfix/record");
var readDataSet = require("../data_sets");
var SKIP_REASONS = require("../skip_reasons");
var Sets = require("../sets");
var TemplateStore = require("../template_store");

// The length of the record at index: its fixed-length fields, and for each variable-length field its prefix and the
// length the prefix gives (RFC 7011 section 7). A prefix past the end of the set makes the record run past it.
var recordLengthAt = function (template, body, index)
{
    var recordLength = 0;
    for (const field of template.FieldSpecifiers) {
        if (field.fieldLength === Sets.VARIABLE_LENGTH) {
            var prefix = Sets.lengthPrefixAt(body, index + recordLength);
            if (prefix === null)
                return Infinity;

            recordLength += prefix.size + prefix.length;
        } else {
            recordLength += field.fieldLength;
        }
    }

    return recordLength;
};

// How a template frames its records, framed by its fields rather than by dataRecordSizeInBytes, which a caller's own
// template may lack: the shortest record it allows (its fixed-length fields, and the 1-byte prefix of each
// variable-length field), and, when it has a variable-length field, the length of the record at an index of the set. A
// field length that is no byte count makes the shortest record NaN.
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

    if (!variable)
        return { shortest: shortest };

    return { shortest: shortest, lengthAt: function (index) { return recordLengthAt(template, body, index); } };
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
        // The message ends at its Length (RFC 7011 section 3.1): bytes after it, such as the next message of a TCP
        // stream, are not its sets. A Length past the bytes given, or inside the header, leaves the walk at their end.
        var length = self.Header.FlowLengthBytes;
        if (length !== buffer.byteLength)
            self.SkippedSets.push({ reason: SKIP_REASONS.MESSAGE_LENGTH });

        var end = length >= self.Header.sizeInBytes && length < buffer.byteLength ? length : buffer.byteLength;
        Sets.walkSets(buffer.slice(self.Header.sizeInBytes, end), self.SkippedSets, function (setId, setDataLength, body)
        {
            var setType = getSetType(setId);
            if (setType == "DataTemplate")
                readTemplateSet(setId, setDataLength, body);
            else if (setType == "OptionTemplate")
                readOptionsTemplateSet(setId, setDataLength, body);
            else if (setType == "DataSet")
                readDataSet(self, params, templates, framingOf, setId, setDataLength, body);
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
