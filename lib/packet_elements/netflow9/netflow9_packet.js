var Netflow9Header = require('./netflow9_header');
var TemplateRecord = require('../flow_set_elements/template_set_netflow9/record');
var OptionsTemplateRecord = require('../flow_set_elements/options_template_set_netflow9/record');
var DataSetRecord = require('../flow_set_elements/data_set/record');
var SKIP_REASONS = require('../skip_reasons');
var Sets = require('../sets');
var TemplateStore = require('../template_store');

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
        templates = new TemplateStore(params, self, self.Header.SourceId);
        Sets.walkSets(buffer.slice(self.Header.sizeInBytes), self.SkippedSets, function (setId, setDataLength, body)
        {
            var setType = getSetType(setId);
            if (setType == 'DataTemplate')
                readTemplateFlowSet(setId, setDataLength, body);
            else if (setType == 'OptionTemplate')
                readOptionsTemplateFlowSet(setId, setDataLength, body);
            else if (setType == 'DataSet')
                readDataFlowSet(setId, setDataLength, body);
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
            if (template.templateId > 255 && templates.store(template, 'DataTemplate', setId))
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
            if (template.templateId > 255 && templates.store(template, 'OptionsTemplate', setId))
                self.OptionsTemplateSets.push(template);
        }
    };
    var readDataFlowSet = function (setId, setDataLength, body)
    {
        var template = templates.get(setId);
        if (template == null)
            return;

        // The records are read by dataRecordSizeInBytes: one that is no positive number would never end. A record
        // reaches DataSetRecord only when that whole size fits, so with a template the parser built, a field of 65535
        // bytes (the IPFIX variable-length marker) is never read in a NetFlow v9 flowset.
        var reason = Sets.unusableReason(template);
        if (reason) {
            self.SkippedSets.push({ setId: setId, templateId: template.templateId, reason: reason });
            return;
        }

        try {
            var recordSize = Number(template.dataRecordSizeInBytes);
            var index = 0;
            while (setDataLength - index >= recordSize) {
                var flow = new DataSetRecord(body.slice(index, setDataLength), { template: template, parseDataValues: params.parseDataValues });
                if (!(flow.sizeInBytes > 0)) {
                    self.SkippedSets.push({ setId: setId, templateId: template.templateId, reason: SKIP_REASONS.EMPTY_RECORD });
                    break;
                }

                index += flow.sizeInBytes;
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
