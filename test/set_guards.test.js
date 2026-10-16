const test = require('node:test');
const assert = require('node:assert');
const decodeWithin = require('./helpers/decode_within');
const SKIP_REASONS = require('../lib/packet_elements/skip_reasons');

// A template whose records hold no byte made the data set loop push empty records forever, and a set the parser
// did not know made the set loop stand still; a shipper task decoding one such message ran out of memory
// (CU-123ymga3b65). Each scenario runs in a worker thread with a deadline and a small heap.

const empty = { records: 0, templates: [], optionsTemplates: [], withdrawals: [], skipped: [] };
const withdrawn = (templateId, templateType) => ({ templateId, templateType });
const skipped = (setId, templateId, reason) => ({ setId, templateId, reason });

// RFC 7011 and RFC 3954 scope templates by observation domain (Observation Domain ID, Source ID): so does the internal
// storage, one per process
test('ipfix: templates of one id in two observation domains are kept apart', async () => {
    const { first, second } = await decodeWithin('ipfix: templates of one id in two observation domains are kept apart');

    assert.deepStrictEqual(first, { ...empty, records: 2 });
    assert.deepStrictEqual(second, { ...empty, records: 3 });
});

test('ipfix: a withdrawal removes the template from its observation domain only', async () => {
    const result = await decodeWithin('ipfix: a withdrawal removes the template from its observation domain only');

    assert.deepStrictEqual(result.withdrawn, { ...empty, withdrawals: [withdrawn(256, 'DataTemplate')] });
    assert.deepStrictEqual(result.first, { ...empty, skipped: [skipped(256, 256, SKIP_REASONS.UNKNOWN_TEMPLATE)] });
    assert.deepStrictEqual(result.second, { ...empty, records: 2 });
});

test('ipfix: a withdrawal of all templates removes those of its observation domain only', async () => {
    const { first, second } = await decodeWithin('ipfix: a withdrawal of all templates removes those of its observation domain only');

    assert.deepStrictEqual(first, {
        ...empty,
        skipped: [skipped(256, 256, SKIP_REASONS.UNKNOWN_TEMPLATE), skipped(257, 257, SKIP_REASONS.UNKNOWN_TEMPLATE)],
    });
    assert.deepStrictEqual(second, { ...empty, records: 2 });
});

// RFC 7011 section 8.1: a template id of 2 in a template set (3 in an options template set) withdraws all of them
test('ipfix: a withdrawal of all templates is passed on with the set id', async () => {
    const { calls, packet } = await decodeWithin('ipfix: a withdrawal of all templates is passed on with the set id');

    const all = [withdrawn(2, 'DataTemplate'), withdrawn(3, 'OptionsTemplate')];
    assert.deepStrictEqual(calls.withdrawn, all);
    assert.deepStrictEqual(packet, { ...empty, withdrawals: all });
});

test('ipfix: a record of no field and a reserved id other than the set id is listed', async () => {
    const packet = await decodeWithin('ipfix: a record of no field and a reserved id other than the set id is listed');

    assert.deepStrictEqual(packet, {
        ...empty,
        skipped: [
            { setId: 2, templateId: 100, reason: SKIP_REASONS.RESERVED_WITHDRAWAL },
            { setId: 3, templateId: 4, reason: SKIP_REASONS.RESERVED_WITHDRAWAL },
        ],
    });
});

test('ipfix: a withdrawal callback that throws or rejects leaves the message read', async () => {
    const packet = await decodeWithin('ipfix: a withdrawal callback that throws or rejects leaves the message read');

    assert.deepStrictEqual(packet, {
        ...empty,
        records: 2,
        templates: [256, 257, 258],
        withdrawals: [
            { ...withdrawn(256, 'DataTemplate'), error: 'storage down' },
            { ...withdrawn(257, 'DataTemplate'), error: 'storage down' },
        ],
    });
});

test('ipfix: the internal storage is used when a templateProvider is also given', async () => {
    const packet = await decodeWithin('ipfix: the internal storage is used when a templateProvider is also given');

    assert.deepStrictEqual(packet, { ...empty, records: 2, templates: [265], withdrawals: [withdrawn(265, 'DataTemplate')] });
});

test('ipfix: records of a variable-length field are framed by their own length prefix', async () => {
    const records = await decodeWithin('ipfix: records of a variable-length field are framed by their own length prefix');

    assert.deepStrictEqual(records, [
        { sizeInBytes: 1 + 4 + 4, nameBytes: 4, octets: '1500' },
        { sizeInBytes: 1 + 9 + 4, nameBytes: 9, octets: '1500' },
        { sizeInBytes: 3 + 300 + 4, nameBytes: 300, octets: '1500' },
    ]);
});

for (const scenario of [
    'ipfix: a templateProvider returning null leaves its data set unread and the message read',
    'netflow9: a templateProvider returning null leaves its flowset unread and the message read',
]) {
    test(scenario, async () => {
        const packet = await decodeWithin(scenario);

        assert.deepStrictEqual(packet, { ...empty, records: 3, templates: [257], skipped: [skipped(256, 256, SKIP_REASONS.UNKNOWN_TEMPLATE)] });
    });
}

test('ipfix: a withdrawal reaches onTemplateWithdrawal, never onNewTemplate', async () => {
    const { calls, packet } = await decodeWithin('ipfix: a withdrawal reaches onTemplateWithdrawal, never onNewTemplate');

    assert.deepStrictEqual(calls.added, [{ templateId: 256, numberFields: 3 }]);
    assert.deepStrictEqual(calls.withdrawn, [withdrawn(256, 'DataTemplate')]);
    assert.deepStrictEqual(packet, {
        ...empty,
        withdrawals: [withdrawn(256, 'DataTemplate')],
        skipped: [skipped(256, 256, SKIP_REASONS.UNKNOWN_TEMPLATE)],
    });
});

test('ipfix: an options template withdrawal is read as 4 bytes, the next record stays aligned', async () => {
    const packet = await decodeWithin('ipfix: an options template withdrawal is read as 4 bytes, the next record stays aligned');

    assert.deepStrictEqual(packet, { ...empty, optionsTemplates: [301], skipped: [skipped(3, 300, SKIP_REASONS.WITHDRAWAL_OVER_UDP)] });
});

test('ipfix: a template of zero-byte records is not stored, and its data set ends', async () => {
    const { calls, packet } = await decodeWithin('ipfix: a template of zero-byte records is not stored, and its data set ends');

    assert.deepStrictEqual(calls.added, []);
    assert.deepStrictEqual(packet, {
        ...empty,
        skipped: [skipped(2, 256, SKIP_REASONS.EMPTY_RECORD), skipped(256, 256, SKIP_REASONS.UNKNOWN_TEMPLATE)],
    });
});

for (const scenario of [
    'ipfix: a data set of a provided template with no fields ends',
    'ipfix: a data set of a provided template of a zero-length field ends',
]) {
    test(scenario, async () => {
        const packet = await decodeWithin(scenario);

        assert.deepStrictEqual(packet, { ...empty, skipped: [{ setId: 256, templateId: 256, reason: SKIP_REASONS.EMPTY_RECORD }] });
    });
}

test('ipfix: an empty set of an unknown id is stepped over', async () => {
    const packet = await decodeWithin('ipfix: an empty set of an unknown id is stepped over');

    assert.deepStrictEqual(packet, { ...empty, records: 2, templates: [257], skipped: [{ setId: 4, reason: SKIP_REASONS.UNKNOWN_SET }] });
});

test('ipfix: a set of an unknown id is stepped over whole', async () => {
    const packet = await decodeWithin('ipfix: a set of an unknown id is stepped over whole');

    assert.deepStrictEqual(packet, { ...empty, records: 2, templates: [258], skipped: [{ setId: 100, reason: SKIP_REASONS.UNKNOWN_SET }] });
});

test('ipfix: trailing zero bytes end the message', async () => {
    const packet = await decodeWithin('ipfix: trailing zero bytes end the message');

    assert.deepStrictEqual(packet, { ...empty, records: 2, templates: [259], skipped: [{ setId: 0, reason: SKIP_REASONS.SHORT_SET }] });
});

test('ipfix: a set shorter than its header ends the message', async () => {
    const packet = await decodeWithin('ipfix: a set shorter than its header ends the message');

    assert.deepStrictEqual(packet, { ...empty, records: 1, templates: [260], skipped: [{ setId: 261, reason: SKIP_REASONS.SHORT_SET }] });
});

test('ipfix: padding shorter than a record ends a template set', async () => {
    const packet = await decodeWithin('ipfix: padding shorter than a record ends a template set');

    assert.deepStrictEqual(packet, { ...empty, records: 1, templates: [261] });
});

test('netflow9: a template of no fields is not stored', async () => {
    const { calls, packet } = await decodeWithin('netflow9: a template of no fields is not stored');

    assert.deepStrictEqual(calls.added, []);
    assert.deepStrictEqual(packet, {
        ...empty,
        skipped: [skipped(0, 256, SKIP_REASONS.EMPTY_RECORD), skipped(256, 256, SKIP_REASONS.UNKNOWN_TEMPLATE)],
    });
});

test('netflow9: a data flowset of a provided template of zero-byte records ends', async () => {
    const packet = await decodeWithin('netflow9: a data flowset of a provided template of zero-byte records ends');

    assert.deepStrictEqual(packet, { ...empty, skipped: [{ setId: 256, templateId: 256, reason: SKIP_REASONS.EMPTY_RECORD }] });
});

test('netflow9: an empty flowset of an unknown id is stepped over', async () => {
    const packet = await decodeWithin('netflow9: an empty flowset of an unknown id is stepped over');

    assert.deepStrictEqual(packet, { ...empty, records: 2, templates: [262], skipped: [{ setId: 2, reason: SKIP_REASONS.UNKNOWN_SET }] });
});

test('netflow9: trailing zero bytes end the message', async () => {
    const packet = await decodeWithin('netflow9: trailing zero bytes end the message');

    assert.deepStrictEqual(packet, { ...empty, records: 2, templates: [263], skipped: [{ setId: 0, reason: SKIP_REASONS.SHORT_SET }] });
});

test('netflow9: the padding that ends a template flowset is not read as a record', async () => {
    const packet = await decodeWithin('netflow9: the padding that ends a template flowset is not read as a record');

    assert.deepStrictEqual(packet, { ...empty, records: 1, templates: [264] });
});

test('ipfix: a set running past the end of the message keeps the records decoded before it', async () => {
    const packet = await decodeWithin('ipfix: a set running past the end of the message keeps the records decoded before it');

    assert.deepStrictEqual(packet, {
        ...empty,
        records: 2,
        templates: [270],
        skipped: [{ setId: 2, reason: SKIP_REASONS.TRUNCATED_SET }, { setId: 2, reason: SKIP_REASONS.RECORD_PAST_SET }],
    });
});

test('ipfix: a data set running past the end of the message keeps its whole records', async () => {
    const packet = await decodeWithin('ipfix: a data set running past the end of the message keeps its whole records');

    assert.deepStrictEqual(packet, { ...empty, records: 2, templates: [270], skipped: [{ setId: 270, reason: SKIP_REASONS.TRUNCATED_SET }] });
});

test('ipfix: an options template record shorter than its header ends the set', async () => {
    const packet = await decodeWithin('ipfix: an options template record shorter than its header ends the set');

    assert.deepStrictEqual(packet, { ...empty, records: 2, templates: [271], skipped: [{ setId: 3, reason: SKIP_REASONS.RECORD_PAST_SET }] });
});

test('ipfix: a variable-length value of 0 bytes is read, one cut short ends the set', async () => {
    const { records, skipped: skips } = await decodeWithin('ipfix: a variable-length value of 0 bytes is read, one cut short ends the set');

    assert.deepStrictEqual(records, [{ sizeInBytes: 1 + 0 + 4, nameBytes: 0, octets: '1500' }]);
    assert.deepStrictEqual(skips, [skipped(401, 401, SKIP_REASONS.RECORD_PAST_SET)]);
});

for (const scenario of [
    'ipfix: a provided template of unreadable field lengths is reported as malformed',
    'netflow9: a provided template without a record size is reported as malformed',
]) {
    test(scenario, async () => {
        const packet = await decodeWithin(scenario);

        assert.deepStrictEqual(packet, { ...empty, skipped: [{ setId: 256, templateId: 256, reason: SKIP_REASONS.MALFORMED_TEMPLATE }] });
    });
}

test('netflow9: a flowset running past the end of the message keeps the records decoded before it', async () => {
    const packet = await decodeWithin('netflow9: a flowset running past the end of the message keeps the records decoded before it');

    assert.deepStrictEqual(packet, {
        ...empty,
        records: 2,
        templates: [272],
        skipped: [{ setId: 0, reason: SKIP_REASONS.TRUNCATED_SET }, { setId: 0, reason: SKIP_REASONS.RECORD_PAST_SET }],
    });
});

// NetFlow v9 has no variable-length field: a record is read only when its whole size fits, which 65535 bytes never do
test('netflow9: a field of 65535 bytes is not read as a variable-length field', async () => {
    const packet = await decodeWithin('netflow9: a field of 65535 bytes is not read as a variable-length field');

    assert.deepStrictEqual(packet, { ...empty, templates: [273] });
});

// RFC 7011 section 8.4: Template Withdrawals MUST NOT be sent over UDP, and a collector over UDP MUST ignore them. A
// stray or forged message would otherwise remove an exporter's templates.
test('ipfix: a withdrawal received over UDP is ignored and listed', async () => {
    const { stored, kept, calls } = await decodeWithin('ipfix: a withdrawal received over UDP is ignored and listed');

    assert.deepStrictEqual(stored, {
        ...empty,
        records: 2,
        skipped: [skipped(2, 256, SKIP_REASONS.WITHDRAWAL_OVER_UDP), skipped(2, 2, SKIP_REASONS.WITHDRAWAL_OVER_UDP)],
    });
    assert.deepStrictEqual(kept, { ...empty, records: 2, skipped: [skipped(2, 256, SKIP_REASONS.WITHDRAWAL_OVER_UDP)] });
    assert.deepStrictEqual(calls.withdrawn, []);
});

// The internal storage is one per process: NetFlow v9 and IPFIX templates of one domain id are not the same templates
test('ipfix: a withdrawal of all templates leaves the NetFlow v9 templates of the same domain id', async () => {
    const { withdrawn: packet, netflow9 } = await decodeWithin('ipfix: a withdrawal of all templates leaves the NetFlow v9 templates of the same domain id');

    assert.deepStrictEqual(packet, { ...empty, withdrawals: [withdrawn(2, 'DataTemplate')], skipped: [skipped(400, 400, SKIP_REASONS.UNKNOWN_TEMPLATE)] });
    assert.deepStrictEqual(netflow9, { ...empty, records: 2 });
});

// RFC 7011 section 3.4.1: a template id is unique to its transport session and observation domain
test('ipfix: templates of one id from two transport sessions are kept apart', async () => {
    const { before, after, withdrawn: packet, unscoped } = await decodeWithin('ipfix: templates of one id from two transport sessions are kept apart');

    assert.deepStrictEqual(before, { ...empty, records: 2 });
    assert.deepStrictEqual(after, { ...empty, records: 2 });
    assert.deepStrictEqual(packet, { ...empty, skipped: [skipped(256, 256, SKIP_REASONS.UNKNOWN_TEMPLATE)] });
    assert.deepStrictEqual(unscoped, { ...empty, skipped: [skipped(256, 256, SKIP_REASONS.UNKNOWN_TEMPLATE)] });
});

// An asynchronous onNewTemplate that rejects was an unhandled rejection, which ends a Node process by default
test('ipfix: a template callback that throws or rejects leaves the message read', async () => {
    const { errors, ...packet } = await decodeWithin('ipfix: a template callback that throws or rejects leaves the message read');

    assert.deepStrictEqual(packet, { ...empty, records: 2, templates: [256, 257, 258] });
    assert.deepStrictEqual(errors, ['storage down', 'storage down', undefined]);
});

// RFC 7011 section 3.3.1: a set may end with zero padding shorter than any record of the set
test('ipfix: zero padding after the records of a data set is not read', async () => {
    const packet = await decodeWithin('ipfix: zero padding after the records of a data set is not read');

    assert.deepStrictEqual(packet, { ...empty, records: 3, templates: [300, 301] });
});

// A template id names one template of its domain, a template or an options template
test('ipfix: a template id redefined with the other kind replaces the template', async () => {
    const { toOptions, toData } = await decodeWithin('ipfix: a template id redefined with the other kind replaces the template');

    assert.deepStrictEqual(toOptions, [[149, 34]]);
    assert.deepStrictEqual(toData, [[8, 12, 1]]);
});

// As for onNewTemplate and onTemplateWithdrawal, the packet is `this`: its header gives the observation domain
test('ipfix: the templateProvider is called with the packet as this', async () => {
    const calls = await decodeWithin('ipfix: the templateProvider is called with the packet as this');

    assert.deepStrictEqual(calls, [{ templateId: 256, version: 10, domain: 7 }, { templateId: 257, version: 9, domain: 8 }]);
});

for (const [scenario, setId] of [
    ['ipfix: a data set of an unknown template is listed', 256],
    ['netflow9: a data flowset of an unknown template is listed', 256],
]) {
    test(scenario, async () => {
        const packet = await decodeWithin(scenario);

        assert.deepStrictEqual(packet, { ...empty, skipped: [skipped(setId, setId, SKIP_REASONS.UNKNOWN_TEMPLATE)] });
    });
}

// Template ids 0 to 255 are reserved (RFC 7011 section 3.4.1, RFC 3954 section 5.2): no data set can use one
test('ipfix: a template of a reserved id is listed', async () => {
    const { calls, packet } = await decodeWithin('ipfix: a template of a reserved id is listed');

    assert.deepStrictEqual(calls.added, []);
    assert.deepStrictEqual(packet, {
        ...empty,
        skipped: [skipped(2, 100, SKIP_REASONS.RESERVED_TEMPLATE), skipped(3, 255, SKIP_REASONS.RESERVED_TEMPLATE)],
    });
});

test('netflow9: a template of a reserved id is listed', async () => {
    const { calls, packet } = await decodeWithin('netflow9: a template of a reserved id is listed');

    assert.deepStrictEqual(calls.added, []);
    assert.deepStrictEqual(packet, { ...empty, skipped: [skipped(0, 100, SKIP_REASONS.RESERVED_TEMPLATE)] });
});

// RFC 7011 section 8.1: a withdrawal of a template the collector does not have MUST be ignored and SHOULD be logged
test('ipfix: a withdrawal of a template not stored is ignored and listed', async () => {
    const { internal, external, calls } = await decodeWithin('ipfix: a withdrawal of a template not stored is ignored and listed');

    assert.deepStrictEqual(internal, {
        ...empty,
        records: 1,
        templates: [258],
        skipped: [skipped(2, 256, SKIP_REASONS.UNKNOWN_WITHDRAWAL), skipped(3, 258, SKIP_REASONS.UNKNOWN_WITHDRAWAL)],
    });
    assert.deepStrictEqual(external, { ...empty, skipped: [skipped(2, 257, SKIP_REASONS.UNKNOWN_WITHDRAWAL)] });
    assert.deepStrictEqual(calls.withdrawn, []);
});

for (const [scenario, setId] of [
    ['ipfix: an options template of zero-byte records is not stored', 3],
    ['netflow9: an options template of zero-byte records is not stored', 1],
]) {
    test(scenario, async () => {
        const packet = await decodeWithin(scenario);

        assert.deepStrictEqual(packet, {
            ...empty,
            skipped: [skipped(setId, 256, SKIP_REASONS.EMPTY_RECORD), skipped(256, 256, SKIP_REASONS.UNKNOWN_TEMPLATE)],
        });
    });
}

// RFC 7011 section 8.1: templates and withdrawals take effect in the order they appear in the message, whenever the
// caller's own storage catches up
test('ipfix: with external storage, the templates and withdrawals of a message apply to its later data sets', async () => {
    const { packet, calls } = await decodeWithin('ipfix: with external storage, the templates and withdrawals of a message apply to its later data sets');

    assert.deepStrictEqual(packet, {
        ...empty,
        records: 2,
        templates: [256],
        withdrawals: [withdrawn(256, 'DataTemplate'), withdrawn(2, 'DataTemplate')],
        skipped: [skipped(256, 256, SKIP_REASONS.UNKNOWN_TEMPLATE), skipped(257, 257, SKIP_REASONS.UNKNOWN_TEMPLATE)],
    });
    assert.deepStrictEqual(calls.withdrawn, [withdrawn(256, 'DataTemplate'), withdrawn(2, 'DataTemplate')]);
});

// RFC 7011 section 8.1: the end of a TCP or SCTP session withdraws all of its templates
test('ipfix: ending a transport session removes its templates only', async () => {
    const { kept, ended, other } = await decodeWithin('ipfix: ending a transport session removes its templates only');

    assert.deepStrictEqual(kept, { ...empty, records: 2 });
    assert.deepStrictEqual(ended, { ...empty, skipped: [skipped(256, 256, SKIP_REASONS.UNKNOWN_TEMPLATE)] });
    assert.deepStrictEqual(other, { ...empty, records: 2 });
});

test('ipfix: a templateProvider that throws leaves its data set unread and the message read', async () => {
    const packet = await decodeWithin('ipfix: a templateProvider that throws leaves its data set unread and the message read');

    assert.deepStrictEqual(packet, {
        ...empty,
        records: 3,
        templates: [257],
        skipped: [{ ...skipped(256, 256, SKIP_REASONS.PROVIDER_ERROR), error: 'cache reloading' }],
    });
});

// RFC 7011 section 3.1: the message ends at its Length; over TCP a read may hold the next message too
test('ipfix: the bytes after the message length are not read as sets', async () => {
    const packet = await decodeWithin('ipfix: the bytes after the message length are not read as sets');

    assert.deepStrictEqual(packet, { ...empty, records: 2, templates: [256], skipped: [{ reason: SKIP_REASONS.MESSAGE_LENGTH }] });
});

test('ipfix: an options template withdrawal of a template is ignored with external storage', async () => {
    const { packet, calls } = await decodeWithin('ipfix: an options template withdrawal of a template is ignored with external storage');

    assert.deepStrictEqual(packet, { ...empty, records: 2, skipped: [skipped(3, 300, SKIP_REASONS.UNKNOWN_WITHDRAWAL)] });
    assert.deepStrictEqual(calls.withdrawn, []);
});

test('ipfix: the transport is checked and read in any case', async () => {
    const result = await decodeWithin('ipfix: the transport is checked and read in any case');

    assert.match(result.typo, /tpc/);
    assert.deepStrictEqual({ ...result, typo: undefined }, { typo: undefined, upper: 1, sctp: 1, unset: 0 });
});

test('ipfix: a session given in the options scopes every message', async () => {
    const { scoped, unscoped, overridden } = await decodeWithin('ipfix: a session given in the options scopes every message');

    assert.deepStrictEqual(scoped, { ...empty, records: 2 });
    assert.deepStrictEqual(unscoped, { ...empty, skipped: [skipped(256, 256, SKIP_REASONS.UNKNOWN_TEMPLATE)] });
    assert.deepStrictEqual(overridden, { ...empty, skipped: [skipped(256, 256, SKIP_REASONS.UNKNOWN_TEMPLATE)] });
});

test('ipfix: a template the callback freezes leaves the message read', async () => {
    const packet = await decodeWithin('ipfix: a template the callback freezes leaves the message read');

    assert.deepStrictEqual(packet, { ...empty, records: 2, templates: [256] });
});

test('ipfix: a length prefix past the end of the set is reported with its template', async () => {
    const packet = await decodeWithin('ipfix: a length prefix past the end of the set is reported with its template');

    assert.deepStrictEqual(packet, { ...empty, templates: [402], skipped: [skipped(402, 402, SKIP_REASONS.RECORD_PAST_SET)] });
});

test('a message too short for its version is rejected, not thrown', async () => {
    assert.strictEqual(await decodeWithin('a message too short for its version is rejected, not thrown'), 'rejected: RangeError');
});

// DataSetRecord reads the fields by position: a provider may hold them as an object, as 1.2.9 read them
test('netflow9: a provided template whose fields are held by position is read', async () => {
    const packet = await decodeWithin('netflow9: a provided template whose fields are held by position is read');

    assert.deepStrictEqual(packet, { ...empty, records: 2 });
});
