var FieldSpecifier = require('./field_specifier');
var Sets = require('../../sets');
var DataSetRecord = function (buffer, params)
{

    this.dataSetType = undefined;
    this.sizeInBytes = undefined;
    this.Fields = [];
    var template = params.template;
    this.templateId = template.templateId;

    var self = this;

    var _construct = function ()
    {
        var currentField = 0;

        var CachedFieldSpecifiers = template.FieldSpecifiers;
        var cfsLength = Object.keys(CachedFieldSpecifiers).length
        var currentField = 0;
        self.sizeInBytes = 0;

        while (currentField < cfsLength) {
            var cachedField = CachedFieldSpecifiers[currentField];
            var prefixSize = 0;
            // A variable-length field (RFC 7011 section 7): the record gives its length in a prefix of 1 byte, or 255
            // then 2 bytes, and the value follows
            if (cachedField.fieldLength === Sets.VARIABLE_LENGTH) {
                var length = buffer.readUInt8(0);
                prefixSize = 1;
                if (length === 255) {
                    length = buffer.readUInt16BE(1);
                    prefixSize = 3;
                }

                buffer = buffer.slice(prefixSize);
                cachedField = Object.assign({}, cachedField, { fieldLength: length });
            }

            var FreshField = new FieldSpecifier(buffer, cachedField, params);
            self.Fields.push(FreshField);
            buffer = buffer.slice(FreshField.sizeInBytes);
            self.sizeInBytes += prefixSize + FreshField.sizeInBytes;
            currentField++;
        }

        return this;
    };

    _construct();
    return this;
};

module.exports = DataSetRecord;