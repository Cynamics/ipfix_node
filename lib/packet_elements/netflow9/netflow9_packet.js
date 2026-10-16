var Netflow9Header = require('./netflow9_header');
var TemplateRecord = require('../flow_set_elements/template_set_netflow9/record');
var OptionsTemplateRecord = require('../flow_set_elements/options_template_set_netflow9/record');
var DataSetRecord = require('../flow_set_elements/data_set/record');
var SKIP_REASONS = require('../skip_reasons');
var Sets = require('../sets');

// Template id, scope length and option length
var OPTIONS_TEMPLATE_HEADER_SIZE = 6;

var NetflowPacket = function (params)
{
    var self = this;
    var buffer = params.buffer;
    var cachedTemplates = params.templates;
    var templateProvider = params.templateProvider;
    var onNewTemplate = params.onNewTemplate;
    var useInternalStorage = params.useInternalStorage;
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
            if (template.templateId > 255 && storeTemplate(template, setId))
                self.TemplateSets.push(template);
        }
    };
    var readOptionsTemplateFlowSet = function (setId, setDataLength, body)
    {
        var index = 0;
        // The flowset ends with padding to a 4-byte boundary, shorter than a record header
        while (setDataLength - index >= OPTIONS_TEMPLATE_HEADER_SIZE) {
            var template = new OptionsTemplateRecord(body.slice(index, setDataLength));
            index += template.sizeInBytes;
            if (template.templateId > 255 && storeTemplate(template, setId))
                self.OptionsTemplateSets.push(template);
        }
    };
    var readDataFlowSet = function (setId, setDataLength, body)
    {
        var template = templateOf(setId);
        if (template == null)
            return;

        // The records are read by dataRecordSizeInBytes: one of 0 would never end
        if (!Sets.isUsableTemplate(template)) {
            self.SkippedSets.push({ setId: setId, templateId: template.templateId, reason: SKIP_REASONS.EMPTY_RECORD });
            return;
        }

        try {
            var index = 0;
            while (setDataLength - index >= template.dataRecordSizeInBytes) {
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
    var templateOf = function (templateId)
    {
        if (!useInternalStorage) {
            if (typeof templateProvider === 'function')
                return templateProvider(templateId);

            throw new Error('Please provide a templateProvider function or set useInternalStorage to true !');
        }

        if (typeof cachedTemplates == 'undefined')
            throw new Error('Please provide a templateProvider function or set useInternalStorage to true !');

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
            templateType = 'OptionsTemplate';
        else if (template instanceof TemplateRecord)
            templateType = 'DataTemplate';
        if (useInternalStorage) {
            if (templateType == 'OptionsTemplate')
                cachedTemplates.OptionsTemplateMap.set(template.templateId, template);
            else if (templateType == 'DataTemplate')
                cachedTemplates.DataTemplateMap.set(template.templateId, template);
        }
        else {
            if (typeof onNewTemplate != 'undefined')
                onNewTemplate.call(self, template, templateType);
            else
                console.error(`Please provde a 'onNewTemplate' option so we can keep you updated with templates, otherwise set 'useInternalStorage' to true so i can do all the work by myself.`);
        }

        return true;
    }
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
