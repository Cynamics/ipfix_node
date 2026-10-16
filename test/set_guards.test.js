const test = require('node:test');
const assert = require('node:assert');
const decodeWithin = require('./helpers/decode_within');
const SKIP_REASONS = require('../lib/packet_elements/skip_reasons');

// A template whose records hold no byte made the data set loop push empty records forever, and a set the parser
// did not know made the set loop stand still; a shipper task decoding one such message ran out of memory
// (CU-123ymga3b65). Each scenario runs in a worker thread with a deadline and a small heap.

const empty = { records: 0, templates: [], optionsTemplates: [], withdrawals: [], skipped: [] };
const withdrawn = (templateId, templateType) => ({ templateId, templateType });

test('ipfix: a withdrawn template is removed from the internal storage', async () => {
    const result = await decodeWithin('ipfix: a withdrawn template is removed from the internal storage');

    assert.deepStrictEqual(result.before, { ...empty, records: 2, templates: [256] });
    assert.deepStrictEqual(result.withdrawn, { ...empty, withdrawals: [withdrawn(256, 'DataTemplate')] });
    assert.deepStrictEqual(result.after, empty);
});

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
