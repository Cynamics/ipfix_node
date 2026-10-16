const test = require('node:test');
const assert = require('node:assert');
const decodeWithin = require('./helpers/decode_within');
const SKIP_REASONS = require('../lib/packet_elements/skip_reasons');

// A template whose records hold no byte made the data set loop push empty records forever, and a set the parser
// did not know made the set loop stand still; a shipper task decoding one such message ran out of memory
// (CU-123ymga3b65). Each scenario runs in a worker thread with a deadline and a small heap.

const empty = { records: 0, templates: [], optionsTemplates: [], withdrawals: [], skipped: [] };
const withdrawn = (templateId, templateType) => ({ templateId, templateType });

// The internal storage is one per process: removing the template would stop another exporter's data of that id, and an
// exporter announces a template again before it sends data of its id
test('ipfix: a withdrawal is reported, and the internal storage, shared by every exporter, keeps the template', async () => {
    const result = await decodeWithin('ipfix: a withdrawal is reported, and the internal storage, shared by every exporter, keeps the template');

    assert.deepStrictEqual(result.before, { ...empty, records: 2, templates: [256] });
    assert.deepStrictEqual(result.withdrawn, { ...empty, withdrawals: [withdrawn(256, 'DataTemplate')] });
    assert.deepStrictEqual(result.after, { ...empty, records: 2 });
});

// RFC 7011 section 8.1: a template id of 2 in a template set (3 in an options template set) withdraws all of them
test('ipfix: a withdrawal of all templates is passed on with the set id', async () => {
    const { calls, packet } = await decodeWithin('ipfix: a withdrawal of all templates is passed on with the set id');

    const all = [withdrawn(2, 'DataTemplate'), withdrawn(3, 'OptionsTemplate')];
    assert.deepStrictEqual(calls.withdrawn, all);
    assert.deepStrictEqual(packet, { ...empty, withdrawals: all });
});

test('ipfix: a record of no field and a reserved id other than the set id is ignored', async () => {
    const packet = await decodeWithin('ipfix: a record of no field and a reserved id other than the set id is ignored');

    assert.deepStrictEqual(packet, empty);
});

test('ipfix: a withdrawal callback that throws or rejects leaves the message read', async () => {
    const packet = await decodeWithin('ipfix: a withdrawal callback that throws or rejects leaves the message read');

    assert.deepStrictEqual(packet, {
        ...empty,
        records: 2,
        templates: [258],
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

        assert.deepStrictEqual(packet, { ...empty, records: 3, templates: [257] });
    });
}

test('ipfix: a withdrawal reaches onTemplateWithdrawal, never onNewTemplate', async () => {
    const { calls, packet } = await decodeWithin('ipfix: a withdrawal reaches onTemplateWithdrawal, never onNewTemplate');

    assert.deepStrictEqual(calls.added, [{ templateId: 256, numberFields: 3 }]);
    assert.deepStrictEqual(calls.withdrawn, [withdrawn(256, 'DataTemplate')]);
    assert.deepStrictEqual(packet, { ...empty, withdrawals: [withdrawn(256, 'DataTemplate')] });
});

test('ipfix: an options template withdrawal is read as 4 bytes, the next record stays aligned', async () => {
    const packet = await decodeWithin('ipfix: an options template withdrawal is read as 4 bytes, the next record stays aligned');

    assert.deepStrictEqual(packet, { ...empty, optionsTemplates: [301], withdrawals: [withdrawn(300, 'OptionsTemplate')] });
});

test('ipfix: a template of zero-byte records is not stored, and its data set ends', async () => {
    const { calls, packet } = await decodeWithin('ipfix: a template of zero-byte records is not stored, and its data set ends');

    assert.deepStrictEqual(calls.added, []);
    assert.deepStrictEqual(packet, { ...empty, skipped: [{ setId: 2, templateId: 256, reason: SKIP_REASONS.EMPTY_RECORD }] });
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
    assert.deepStrictEqual(packet, { ...empty, skipped: [{ setId: 0, templateId: 256, reason: SKIP_REASONS.EMPTY_RECORD }] });
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
