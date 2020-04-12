var FieldSpecifier = require('./field_specifier');
var DataSetRecord = function(buffer, params){
    this.templateId = undefined;
    this.dataSetType = undefined;
    this.sizeInBytes = undefined;
    this.Fields = [];
    var template = params.template;

    var self = this;

    var _construct = function() {
        var currentField = 0;

        var CachedFieldSpecifiers = template.FieldSpecifiers;
        var cfsLength = Object.keys(CachedFieldSpecifiers).length
        var currentField = 0;
        self.sizeInBytes = 0;
        
        while (currentField < cfsLength) {
            var cachedField = CachedFieldSpecifiers[currentField];
            var FreshField = new FieldSpecifier(buffer, cachedField, params);
            self.Fields.push(FreshField);
            buffer = buffer.slice(FreshField.sizeInBytes);
            self.sizeInBytes += FreshField.sizeInBytes;
            currentField++;
        }
    
        return this;
    };

    _construct();
    return this;
};

module.exports = DataSetRecord;