var Netflow9Header = require('./netflow9_header');
var TemplateRecord = require('../flow_set_elements/template_set_netflow9/record');
var OptionsTemplateRecord = require('../flow_set_elements/options_template_set_netflow9/record');
var readDataSet = require('../data_sets');
var SKIP_REASONS = require('../skip_reasons');
var Sets = require('../sets');
var TemplateStore = require('../template_store');

// How a template frames its records: NetFlow v9 has no variable-length field, each record is dataRecordSizeInBytes long.
// With a template the parser built, a field of 65535 bytes (the IPFIX variable-length marker) is never read: no record
// of it fits in a flowset. A provider's template may hold its fields as an object by position, as DataSetRecord reads
// them; one without fields is unreadable.
var framingOf = function (template)
{
    var fields = template.FieldSpecifiers;
    return { shortest: fields !== null && typeof fields == 'object' ? Number(template.dataRecordSizeInBytes) : NaN };
};

var NetflowPacket = function (params)
{
    var self = this;
    var buffer = params.buffer;
    var templates = undefined;
    this.Header = undefined;
    this.DataSets = [];
    this.TemplateSets = [];
    this.OptionsTemplateSets = [];
    // NetFlow v9 has no template withdrawal: always empty, so a packet has the same shape as an IPFIX one
    this.TemplateWithdrawals = [];
    this.SkippedSets = [];
    var _construct = function (buffer)
    {
        self.Header = new Netflow9Header(buffer);
        templates = new TemplateStore(params, self, self.Header.Version, self.Header.SourceId);
        Sets.walkSets(buffer.slice(self.Header.sizeInBytes), self.SkippedSets, function (setId, setDataLength, body)
        {
            var setType = getSetType(setId);
            if (setType == 'DataTemplate')
                readTemplateFlowSet(setId, setDataLength, body);
            else if (setType == 'OptionTemplate')
                readOptionsTemplateFlowSet(setId, setDataLength, body);
            else if (setType == 'DataSet')
                readDataSet(self, params, templates, framingOf, setId, setDataLength, body);
            else
                self.SkippedSets.push({ setId: setId, reason: SKIP_REASONS.UNKNOWN_SET });
        });
    };
    var readTemplateFlowSet = function (setId, setDataLength, body)
    {
        var index = 0;
        // The flowset ends with padding to a 4-byte boundary, shorter than a record header
        while (setDataLength - index >= Sets.TEMPLATE_RECORD_HEADER_SIZE) {
            var template = new TemplateRecord(body.slice(index, setDataLength));
            index += template.sizeInBytes;
            if (templates.store(template, 'DataTemplate', setId))
                self.TemplateSets.push(template);
        }
    };
    var readOptionsTemplateFlowSet = function (setId, setDataLength, body)
    {
        var index = 0;
        // The flowset ends with padding to a 4-byte boundary, shorter than a record header
        while (setDataLength - index >= Sets.OPTIONS_TEMPLATE_HEADER_SIZE) {
            var template = new OptionsTemplateRecord(body.slice(index, setDataLength));
            index += template.sizeInBytes;
            if (templates.store(template, 'OptionsTemplate', setId))
                self.OptionsTemplateSets.push(template);
        }
    };
    var getSetType = function (setId)
    {
        if (setId == 0)
            return 'DataTemplate';
        else if (setId == 1)
            return 'OptionTemplate';
        else if (setId > 255)
            return 'DataSet';
    }
    _construct(buffer);
    return this;
}

NetflowPacket.prototype.NetflowHeader = Netflow9Header;
module.exports = NetflowPacket;
