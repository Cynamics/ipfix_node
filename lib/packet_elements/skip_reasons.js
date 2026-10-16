// Why a parser left a set or a template undecoded. Each skip is listed on the parsed packet's SkippedSets, so the
// caller can report it: the parser itself does not log.
module.exports = {
    // A set header is 4 bytes and the set length counts it: a shorter set cannot be stepped over, the message ends
    SHORT_SET: 'set shorter than its header',
    // The set length runs past the end of the message: the whole records of the set are read, then the message ends
    TRUNCATED_SET: 'set longer than the rest of the message',
    // A record of the set runs past the set's end: the records before it are kept, the next set is read
    RECORD_PAST_SET: 'record past the end of its set',
    // Not a template, an options template nor a data set: stepped over whole
    UNKNOWN_SET: 'unknown set id',
    // A template whose records hold no byte: not stored, and a data set of it is not read, as its records would never end
    EMPTY_RECORD: 'template of zero-byte records',
    // A template whose field lengths or record size are not numbers (a provider's own template): not used
    MALFORMED_TEMPLATE: 'template of unreadable field lengths',
    // A template record of no field whose id is reserved (255 or below) and not the set id: neither a template nor a
    // withdrawal (RFC 7011 section 8.1)
    RESERVED_WITHDRAWAL: 'withdrawal of a reserved template id',
};
