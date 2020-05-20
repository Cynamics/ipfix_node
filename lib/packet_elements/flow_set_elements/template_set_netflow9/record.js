const _ = require('lodash');
var TemplateRecordFieldSpecifier = require('./field_specifier');
var TemplateRecord = function(buffer) {
    var self = this;
    this.templateId = undefined;
    this.numberFields = undefined;
    this.sizeInBytes = undefined;
    this.dataRecordSizeInBytes = undefined;
    this.FieldSpecifiers = []
    var _construct = function() {
        self.sizeInBytes = 0;
        self.templateId = buffer.readUInt16BE(0);
        self.numberFields = buffer.readUInt16BE(2);
        buffer = buffer.slice(4);
        self.sizeInBytes += 4;
        self.dataRecordSizeInBytes = 0;
        
        while (self.FieldSpecifiers.length < self.numberFields) {
            var FreshSpecifier = new TemplateRecordFieldSpecifier(buffer);
            self.FieldSpecifiers.push(FreshSpecifier);
            buffer = buffer.slice(4);
            self.sizeInBytes += 4;
            self.dataRecordSizeInBytes += FreshSpecifier.fieldLength;
        }
        return this;
    }

    _construct();
    return this;
};

module.exports = TemplateRecord;