var Netflow9Header = require('./netflow9_header');
var TemplateRecord = require('../flow_set_elements/template_set_netflow9/record');
var OptionsTemplateRecord = require('../flow_set_elements/options_template_set_netflow9/record');
var DataSetRecord = require('../flow_set_elements/data_set/record');

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
    var _construct = function (buffer)
    {
        self.Header = new Netflow9Header(buffer);
        buffer = buffer.slice(self.Header.sizeInBytes);
        while (buffer.byteLength > 0) {
            var setId = buffer.readUInt16BE(0);
            var setType = getSetType(setId);
            var sizeInBytes = buffer.readUInt16BE(2);
            if (setType == 'DataTemplate') {
                buffer = buffer.slice(4)
                let setDataLength = sizeInBytes - 4;
                let index = 0;
                while (index < setDataLength) {
                    let template = new TemplateRecord(buffer.slice(index, setDataLength))
                    index += template.sizeInBytes;
                    if (template.templateId > 255) {
                        storeTemplate(template);
                        self.TemplateSets.push(template);
                    }
                }
            } else if (setType == 'OptionTemplate') {
                buffer = buffer.slice(4)
                let setDataLength = sizeInBytes - 4;
                let index = 0;
                while (index < setDataLength) {
                    let template = new OptionsTemplateRecord(buffer.slice(index, setDataLength));
                    index += template.sizeInBytes;
                    if (template.templateId > 255) {
                        storeTemplate(template);
                        self.OptionsTemplateSets.push(template);
                    }
                }
            } else if (setType == 'DataSet') {
                // Try to decode DataSet with templates for exporter
                var templateNeeded = getTemplateMD(buffer);
                var template = undefined;
                if (!useInternalStorage) {
                    if (typeof templateProvider === 'function')
                        template = templateProvider(templateNeeded.id);
                    else
                        throw new Error('Please provide a templateProvider function or set useInternalStorage to true !');
                }
                else if (typeof cachedTemplates != 'undefined') {
                    if (cachedTemplates.DataTemplateMap.has(templateNeeded.id))
                        template = cachedTemplates.DataTemplateMap.get(templateNeeded.id);
                    else if (cachedTemplates.OptionsTemplateMap.has(templateNeeded.id))
                        template = cachedTemplates.OptionsTemplateMap.get(templateNeeded.id);
                    else {
                        console.error(`Couldn't deserialize template with id ${templateNeeded.id}`);
                        console.error(`Missing template with id ${templateNeeded.id} in local storage ! `);
                    }
                }
                else {
                    throw new Error('Please provide a templateProvider function or set useInternalStorage to true !');
                }

                if (typeof template == 'undefined') {
                    return; // Template not found, skipping this set
                }

                buffer = buffer.slice(4);
                try {
                    let setDataLength = sizeInBytes - 4;
                    let index = 0;
                    let recordSize = setDataLength - index;
                    while (index < setDataLength && recordSize >= template.dataRecordSizeInBytes) {
                        let flow = new DataSetRecord(buffer.slice(index, setDataLength), { template: template, parseDataValues: params.parseDataValues });
                        index += flow.sizeInBytes;
                        flow.templateId = template.templateId;
                        self.DataSets.push(flow);
                        recordSize = setDataLength - index;
                    }
                } catch (e) {
                    console.error(e);
                    console.error(`Couldn't deserialize template with id ${templateNeeded.id}`);
                    console.error(`Template with id ${templateNeeded.id} has invalid structure !`);
                }
                buffer = buffer.slice(sizeInBytes - 4); // Compensating for set header

            }
        }
    };
    var getTemplateMD = function (buffer)
    {
        var templateId = buffer.readUInt16BE(0);
        return {
            id: templateId
        };
    };
    var storeTemplate = function (template)
    {
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