var IpfixHeader = require("./ipfix_header");
var TemplateRecord = require("../flow_set_elements/template_set_ipfix/record");
var OptionsTemplateRecord = require("../flow_set_elements/options_template_set_ipfix/record");
var DataSetRecord = require("../flow_set_elements/data_set/record");
var SKIP_REASONS = require("../skip_reasons");

// A set header: set id and length
var SET_HEADER_SIZE = 4;
// A template record header: template id and field count. A template withdrawal (RFC 7011 section 8.1) is this
// header alone, with a field count of 0, for an options template too
var TEMPLATE_RECORD_HEADER_SIZE = 4;

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
        buffer = buffer.slice(self.Header.sizeInBytes);
        while (buffer.byteLength > 0) {
            if (buffer.byteLength < SET_HEADER_SIZE) {
                self.SkippedSets.push({ reason: SKIP_REASONS.SHORT_SET });
                break;
            }
            var setId = buffer.readUInt16BE(0);
            var setType = getSetType(setId);
            var sizeInBytes = buffer.readUInt16BE(2);
            if (sizeInBytes < SET_HEADER_SIZE) {
                self.SkippedSets.push({ setId: setId, reason: SKIP_REASONS.SHORT_SET });
                break;
            }
            if (setType == "DataTemplate") {
                buffer = buffer.slice(4);
                let setDataLength = sizeInBytes - 4;
                let index = 0;
                // The set may end with padding, shorter than a record header
                while (setDataLength - index >= TEMPLATE_RECORD_HEADER_SIZE) {
                    let template = new TemplateRecord(buffer.slice(index, setDataLength));
                    index += template.sizeInBytes;
                    if (template.templateId <= 255) {
                        continue;
                    }

                    if (template.numberFields === 0) {
                        withdrawTemplate(template.templateId, "DataTemplate");
                    } else if (!(template.dataRecordSizeInBytes > 0)) {
                        self.SkippedSets.push({ setId: setId, templateId: template.templateId, reason: SKIP_REASONS.EMPTY_RECORD });
                    } else {
                        storeTemplate(template);
                        self.TemplateSets.push(template);
                    }
                }
            } else if (setType == "OptionTemplate") {
                buffer = buffer.slice(4);
                let setDataLength = sizeInBytes - 4;
                let index = 0;
                while (setDataLength - index >= TEMPLATE_RECORD_HEADER_SIZE) {
                    // A withdrawal has no scope field count: its record is the template id and a field count of 0
                    if (buffer.readUInt16BE(index + 2) === 0) {
                        let templateId = buffer.readUInt16BE(index);
                        index += TEMPLATE_RECORD_HEADER_SIZE;
                        if (templateId > 255) {
                            withdrawTemplate(templateId, "OptionsTemplate");
                        }

                        continue;
                    }

                    let template = new OptionsTemplateRecord(
                        buffer.slice(index, setDataLength)
                    );
                    index += template.sizeInBytes;
                    if (template.templateId <= 255) {
                        continue;
                    }

                    if (!(template.dataRecordSizeInBytes > 0)) {
                        self.SkippedSets.push({ setId: setId, templateId: template.templateId, reason: SKIP_REASONS.EMPTY_RECORD });
                    } else {
                        storeTemplate(template);
                        self.OptionsTemplateSets.push(template);
                    }
                }
            } else if (setType == "DataSet") {
                // Try to decode DataSet with templates for exporter
                var templateNeeded = getTemplateMD(buffer);
                var template = undefined;
                if (!useInternalStorage) {
                    if (typeof templateProvider === "function")
                        template = templateProvider(templateNeeded.id);
                    else
                        throw new Error(
                            "Please provide a templateProvider function or set useInternalStorage to true !"
                        );
                } else if (typeof cachedTemplates != "undefined") {
                    if (cachedTemplates.DataTemplateMap.has(templateNeeded.id))
                        template = cachedTemplates.DataTemplateMap.get(templateNeeded.id);
                    else if (cachedTemplates.OptionsTemplateMap.has(templateNeeded.id))
                        template = cachedTemplates.OptionsTemplateMap.get(
                            templateNeeded.id
                        );
                    else {
                        console.error(
                            `Couldn't deserialize template with id ${templateNeeded.id}`
                        );
                        console.error(
                            `Missing template with id ${templateNeeded.id} in local storage ! `
                        );
                    }
                } else {
                    throw new Error(
                        "Please provide a templateProvider function or set useInternalStorage to true !"
                    );
                }
                buffer = buffer.slice(4);
                if (typeof template != 'undefined') {
                    try {
                    let setDataLength = sizeInBytes - 4;
                    let index = 0;
                    let recordSize = setDataLength - index;
                    // Process each data record in the set
                    while (index < setDataLength) {
                        let recordLength = 0;

                        // Calculate the actual record size dynamically based on the template
                        for (const field of template.FieldSpecifiers) {
                            if (field.fieldLength === 0xffff) {
                                // For variable-length fields, read the length prefix
                                let dynamicLength = buffer.readUInt8(recordLength);
                                if (dynamicLength === 255) {
                                    // If the length prefix is 255, the actual length is in the next 2 bytes
                                    dynamicLength = buffer.readUInt16BE(recordLength + 1);
                                    recordLength += dynamicLength + 3; // Add 3 bytes (1 for the prefix + 2 for length)
                                } else {
                                    recordLength += dynamicLength + 1; // Add 1 byte for the length prefix
                                }
                            } else {
                                // For fixed-length fields
                                recordLength += field.fieldLength;
                            }
                        }

                        if (!(recordLength > 0)) {
                            // index would never move: the set is left whole
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

                        // Parse the record using the calculated length
                        const flow = new DataSetRecord(
                            buffer.slice(index, index + recordLength),
                            {
                                template: template,
                                parseDataValues: params.parseDataValues,
                            }
                        );
                        index += recordLength;

                        flow.templateId = template.templateId;
                        self.DataSets.push(flow);
                    }
                    } catch (e) {
                        console.error(e);
                        console.error(`Couldn't deserialize template with id ${templateNeeded.id}`);
                        console.error(`Template with id ${templateNeeded.id} has invalid structure !`);
                    }
                }
            } else {
                // Stepped over whole, its header with it
                buffer = buffer.slice(SET_HEADER_SIZE);
                self.SkippedSets.push({ setId: setId, reason: SKIP_REASONS.UNKNOWN_SET });
            }

            buffer = buffer.slice(sizeInBytes - 4); // Compensating for set header
        }
    };
    var getTemplateMD = function (buffer)
    {
        var templateId = buffer.readUInt16BE(0);
        return {
            id: templateId,
        };
    };
    var storeTemplate = function (template)
    {
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
    };
    // A template withdrawal (RFC 7011 section 8.1): the exporter no longer uses this template id
    var withdrawTemplate = function (templateId, templateType)
    {
        self.TemplateWithdrawals.push({ templateId: templateId, templateType: templateType });
        if (useInternalStorage) {
            if (templateType == "OptionsTemplate")
                cachedTemplates.OptionsTemplateMap.delete(templateId);
            else
                cachedTemplates.DataTemplateMap.delete(templateId);
        } else if (typeof onTemplateWithdrawal == "function") {
            onTemplateWithdrawal.call(self, templateId, templateType);
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
