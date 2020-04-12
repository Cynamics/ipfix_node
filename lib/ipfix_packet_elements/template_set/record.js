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
            // Sophos SG use unreserved field (8 bytes length)
            // here we handle with this case
            if(buffer.readUInt16BE(0) > 500) {
                var FreshSpecifier = new TemplateRecordFieldSpecifier(buffer);
                //represents unassigned field
                FreshSpecifier.fieldId = "483-32767";
                self.FieldSpecifiers.push(FreshSpecifier);
                buffer = buffer.slice(8);
                self.sizeInBytes += 8;
                self.dataRecordSizeInBytes += FreshSpecifier.fieldLength;
                continue
            }
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