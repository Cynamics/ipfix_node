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
            if(!_.isEmpty(FreshSpecifier.enterpriseId)) { // The PEN flag is on, this is an enterprise field
                buffer = buffer.slice(8);
                self.sizeInBytes += 8;
                self.dataRecordSizeInBytes += FreshSpecifier.fieldLength;
            }
            else {
                buffer = buffer.slice(4);
                self.sizeInBytes += 4;
                self.dataRecordSizeInBytes += FreshSpecifier.fieldLength;
            }
        }
        return this;
    }

    _construct();
    return this;
};

module.exports = TemplateRecord;