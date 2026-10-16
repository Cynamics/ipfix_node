var SKIP_REASONS = require("./skip_reasons");

// A set header: set id and length (a NetFlow v9 flowset has the same)
var SET_HEADER_SIZE = 4;
// A template record header: template id and field count. An IPFIX template withdrawal (RFC 7011 section 8.1) is this
// header alone, with a field count of 0, for an options template too
var TEMPLATE_RECORD_HEADER_SIZE = 4;
// An options template record header: template id, then two counts (IPFIX: fields and scope fields; NetFlow v9: the
// scope and option lengths)
var OPTIONS_TEMPLATE_HEADER_SIZE = 6;
// The field length of a variable-length field (RFC 7011 section 7): its record gives the length in a prefix
var VARIABLE_LENGTH = 0xffff;
// The codes of a Buffer read past its end
var READ_PAST_END = ["ERR_OUT_OF_RANGE", "ERR_BUFFER_OUT_OF_BOUNDS"];

/**
 * Walks the sets of a message, calling onSet(setId, setDataLength, body) for each, body being the set without its
 * header. Each skip is listed in skippedSets:
 * - a set length below the header, or fewer than 4 bytes left, cannot be stepped over: the walk ends there;
 * - a set longer than the rest of the message is read as far as it goes, then the walk ends;
 * - a record that runs past the end of its set ends that set: the records read before it are kept.
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

        var body = buffer.slice(SET_HEADER_SIZE, sizeInBytes);
        if (sizeInBytes > buffer.byteLength)
            skippedSets.push({ setId: setId, reason: SKIP_REASONS.TRUNCATED_SET });

        try {
            onSet(setId, body.byteLength, body);
        } catch (error) {
            if (!error || READ_PAST_END.indexOf(error.code) < 0)
                throw error;

            skippedSets.push({ setId: setId, reason: SKIP_REASONS.RECORD_PAST_SET });
        }

        buffer = buffer.slice(sizeInBytes);
    }
};

// Why records cannot be read with a template, or null when they can. One of no fields, or of zero-length fields only,
// describes records of no byte, whose data set would never end; a provider's own template may lack a record size.
var unusableReason = function (template)
{
    var size = Number(template.dataRecordSizeInBytes);
    if (!Number.isFinite(size))
        return SKIP_REASONS.MALFORMED_TEMPLATE;

    return size > 0 ? null : SKIP_REASONS.EMPTY_RECORD;
};

module.exports = {
    SET_HEADER_SIZE: SET_HEADER_SIZE,
    TEMPLATE_RECORD_HEADER_SIZE: TEMPLATE_RECORD_HEADER_SIZE,
    OPTIONS_TEMPLATE_HEADER_SIZE: OPTIONS_TEMPLATE_HEADER_SIZE,
    VARIABLE_LENGTH: VARIABLE_LENGTH,
    walkSets: walkSets,
    unusableReason: unusableReason,
};
