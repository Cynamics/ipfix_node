var FieldSpecifier = require('./field_specifier');
var OptionsTemplateRecord = function(buffer){
    // Self explaining
    this.templateId = undefined;
    // Number of all fields in this Options Template Record, including the Scope Fields.
    this.numberFields = undefined;
    this.sizeInBytes = undefined;
    this.dataRecordSizeInBytes = undefined;
    // Number of scope fields in this Options Template Record
    this.scopeFieldCount = undefined;
    this.FieldSpecifiers = [];

    var self = this;
    
    var _construct = function() {
        self.sizeInBytes = 0;
        self.templateId = buffer.readUInt16BE(0);
        self.numberFields = buffer.readUInt16BE(2);
        self.scopeFieldCount = buffer.readUInt16BE(4);
        buffer = buffer.slice(6);
        self.sizeInBytes += 6;
        self.dataRecordSizeInBytes = 0;

        while (self.FieldSpecifiers.length < self.numberFields) {
            if(buffer.readUInt16BE(0) > 500) {
                var FreshSpecifier = new FieldSpecifier(buffer);
                FreshSpecifier.fieldId = "483-32767";
                self.FieldSpecifiers.push(FreshSpecifier);
                buffer = buffer.slice(8);
                self.sizeInBytes += 8;
                self.dataRecordSizeInBytes += FreshSpecifier.fieldLength;
                continue
            }
            var FreshSpecifier = new FieldSpecifier(buffer);
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

module.exports = OptionsTemplateRecord;