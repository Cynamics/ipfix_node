const test = require('node:test');
const assert = require('node:assert');
const Netflow = require('../deserializer');

// A NetFlow v9 header (RFC 3954 section 5.1): version, count, uptime, seconds, sequence, source id.
const header = count => {
    const buffer = Buffer.alloc(20);
    buffer.writeUInt16BE(9, 0);
    buffer.writeUInt16BE(count, 2);
    return buffer;
};

// A flowset: its id, its length including this 4-byte header, the body, then zero padding.
const flowSet = (id, body, padding = 0) => {
    const head = Buffer.alloc(4);
    head.writeUInt16BE(id, 0);
    head.writeUInt16BE(4 + body.length + padding, 2);
    return Buffer.concat([head, body, Buffer.alloc(padding)]);
};

const fields = list => Buffer.concat(list.map(([type, length]) => {
    const field = Buffer.alloc(4);
    field.writeUInt16BE(type, 0);
    field.writeUInt16BE(length, 2);
    return field;
}));

// A sampler options table as a Cisco router sends it: scope System, then sampler id, mode, random interval
// and name. The two lengths after the template id are in bytes (RFC 3954 section 6.1), not field counts.
const SCOPE = [[1, 4]];
const OPTIONS = [[48, 1], [49, 1], [50, 4], [84, 8]];
const optionsTemplate = templateId => {
    const head = Buffer.alloc(6);
    head.writeUInt16BE(templateId, 0);
    head.writeUInt16BE(SCOPE.length * 4, 2);
    head.writeUInt16BE(OPTIONS.length * 4, 4);
    return Buffer.concat([head, fields(SCOPE), fields(OPTIONS)]);
};

const optionsRecord = () => {
    const record = Buffer.alloc(4 + 1 + 1 + 4 + 8);
    record.writeUInt32BE(7, 0); // System
    record.writeUInt8(3, 4); // Sampler id
    record.writeUInt8(2, 5); // Mode: random
    record.writeUInt32BE(100, 6); // 1 out of 100
    record.write('smp-1', 10, 'ascii');
    return record;
};

test('reads a NetFlow v9 options template by its scope and option lengths', async () => {
    const packet = Buffer.concat([header(2), flowSet(1, optionsTemplate(300)), flowSet(300, optionsRecord())]);
    const parsed = await Netflow().deserialize(packet);

    const template = parsed.OptionsTemplateSets[0];
    assert.strictEqual(template.templateId, 300);
    assert.strictEqual(template.scopeFieldCount, 1);
    assert.strictEqual(template.numberFields, 5);
    assert.deepStrictEqual(template.FieldSpecifiers.map(field => field.fieldId), [1, 48, 49, 50, 84]);
    assert.strictEqual(template.sizeInBytes, 6 + 5 * 4);
    assert.strictEqual(template.dataRecordSizeInBytes, 18);

    assert.strictEqual(parsed.DataSets.length, 1);
    const values = Object.fromEntries(parsed.DataSets[0].Fields.map(field => [field.fieldId, field.fieldValueParsed]));
    assert.strictEqual(values[48], '3');
    assert.strictEqual(values[50], '100');
});

// One scope field and three option fields: the only layout the field counts read correctly before.
test('reads a sampler table of one scope and three option fields as before', async () => {
    const head = Buffer.alloc(6);
    head.writeUInt16BE(302, 0);
    head.writeUInt16BE(4, 2);
    head.writeUInt16BE(12, 4);
    const template = Buffer.concat([head, fields([[1, 4], [48, 1], [49, 1], [50, 4]])]);
    const parsed = await Netflow().deserialize(Buffer.concat([header(1), flowSet(1, template)]));

    assert.deepStrictEqual(parsed.OptionsTemplateSets[0].FieldSpecifiers.map(field => field.fieldId), [1, 48, 49, 50]);
    assert.strictEqual(parsed.OptionsTemplateSets[0].scopeFieldCount, 1);
});

test('stops at the padding that ends a NetFlow v9 options template flowset', async () => {
    const packet = Buffer.concat([header(1), flowSet(1, optionsTemplate(301), 2)]);
    const parsed = await Netflow().deserialize(packet);

    assert.deepStrictEqual(parsed.OptionsTemplateSets.map(template => template.templateId), [301]);
});
