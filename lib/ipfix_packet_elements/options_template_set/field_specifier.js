const PEN_FLAG_VALUE = 32768;
var OptionsTemplateFieldSpecifier = function(buffer) {
    var self = this;
    this.fieldId = undefined;
    this.fieldLength = undefined;
    this.enterpriseId = undefined;
    this.enterpriseFieldId = undefined;
    var _construct = function() {
        self.fieldId = buffer.readUInt16BE(0);
        self.fieldLength = buffer.readUInt16BE(2);
        if (self.fieldId >= PEN_FLAG_VALUE){ // The PEN flag is on
            self.enterpriseId = buffer.readUInt32BE(4,8)
            self.enterpriseFieldId = self.fieldId - PEN_FLAG_VALUE;
            self.fieldId = "ENTERPRISE"; //represents unassigned field
        }
        return;
    };

    _construct();
    return this;
};
module.exports = OptionsTemplateFieldSpecifier;