var SKIP_REASONS = require("./skip_reasons");

// A set header: set id and length (a NetFlow v9 flowset has the same)
var SET_HEADER_SIZE = 4;
// A template record header: template id and field count. An IPFIX template withdrawal (RFC 7011 section 8.1) is this
// header alone, with a field count of 0, for an options template too
var TEMPLATE_RECORD_HEADER_SIZE = 4;
// The field length of a variable-length field (RFC 7011 section 7): its record gives the length in a prefix
var VARIABLE_LENGTH = 0xffff;

/**
 * Walks the sets of a message, calling onSet(setId, setDataLength, body) for each, body being the set without its
 * header. A set length below the header, or fewer than 4 bytes left, cannot be stepped over: the walk ends there and
 * the skip is listed in skippedSets.
 */
var walkSets = function (buffer, skippedSets, onSet)
{
    while (buffer.byteLength > 0) {
        if (buffer.byteLength < SET_HEADER_SIZE) {
            skippedSets.push({ reason: SKIP_REASONS.SHORT_SET });
            return;
        }

        var setId = buffer.readUInt16BE(0);
        var sizeInBytes = buffer.readUInt16BE(2);
        if (sizeInBytes < SET_HEADER_SIZE) {
            skippedSets.push({ setId: setId, reason: SKIP_REASONS.SHORT_SET });
            return;
        }

        onSet(setId, sizeInBytes - SET_HEADER_SIZE, buffer.slice(SET_HEADER_SIZE, sizeInBytes));
        buffer = buffer.slice(sizeInBytes);
    }
};

// Whether records can be read with a template: one of no fields, or of zero-length fields only, describes records of
// no byte, and a data set of it would never end. A template provider may also return null for an unknown id.
var isUsableTemplate = function (template)
{
    return template != null && template.dataRecordSizeInBytes > 0;
};

module.exports = {
    SET_HEADER_SIZE: SET_HEADER_SIZE,
    TEMPLATE_RECORD_HEADER_SIZE: TEMPLATE_RECORD_HEADER_SIZE,
    VARIABLE_LENGTH: VARIABLE_LENGTH,
    walkSets: walkSets,
    isUsableTemplate: isUsableTemplate,
};
