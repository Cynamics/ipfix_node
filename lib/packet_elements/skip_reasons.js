// Why a parser left a set or a template undecoded. Each skip is listed on the parsed packet's SkippedSets, so the
// caller can report it: the parser itself does not log.
module.exports = {
    // A set header is 4 bytes and the set length counts it: a shorter set cannot be stepped over, the message ends
    SHORT_SET: 'set shorter than its header',
    // Not a template, an options template nor a data set: stepped over whole
    UNKNOWN_SET: 'unknown set id',
    // A template whose records hold no byte: not stored, and a data set of it is not read, as its records would never end
    EMPTY_RECORD: 'template of zero-byte records',
};
