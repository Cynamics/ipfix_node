const _ = require('lodash');
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
        // NetFlow v9 gives the length in bytes of the scope fields, then of the option fields (RFC 3954
        // section 6.1), four bytes per field. IPFIX gives field counts instead.
        var scopeLength = buffer.readUInt16BE(2);
        var optionLength = buffer.readUInt16BE(4);
        self.scopeFieldCount = Math.floor(scopeLength / 4);
        self.numberFields = self.scopeFieldCount + Math.floor(optionLength / 4);
        buffer = buffer.slice(6);
        self.sizeInBytes += 6;
        self.dataRecordSizeInBytes = 0;

        while (self.FieldSpecifiers.length < self.numberFields) {
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