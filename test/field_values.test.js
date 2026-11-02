const test = require('node:test');
const assert = require('node:assert');
const { decodeMatrix, decodeAtLength, fieldIds, PROTOCOLS } = require('./helpers/field_matrix');
const exceptionsRaised = require('./helpers/exceptions_raised');
const golden = require('./fixtures/decoded_fields.json');

// fixtures/decoded_fields.json was written from the code as it stood before the field parsing changed (run
// test/helpers/field_matrix.js). A change that makes decoding cheaper must leave every value of it as it is.
test('the golden values cover both protocols, with and without parsed values', () => {
    for (const [mode, fields] of Object.entries(golden)) {
        assert.strictEqual(Object.keys(fields).length, 336, mode);
    }

    assert.strictEqual(Object.keys(golden).length, 4);
});

test('every data type at every field length decodes to the same values', async () => {
    // Through JSON, as the fixture went: without parsed values a field's fieldValueParsed is undefined
    assert.deepStrictEqual(JSON.parse(JSON.stringify(await decodeMatrix())), golden);
});

// A data type parseByType could not read raised an exception on every record, and unsigned64, the byte and packet
// counters, was one of them: most of a decode went on raising them (CU-123ymga6v73). A 6-byte or 16-byte field can
// still raise one: its fallback is not the raw value, and those fields are rare.
for (const [name, message] of Object.entries(PROTOCOLS)) {
    for (const length of [1, 2, 3, 4, 8, 32]) {
        test(`${name}: no data type raises an exception at ${length} bytes`, async () => {
            let raised = 0;
            await decodeAtLength(message, fieldIds(), length, true, async run => {
                raised = await exceptionsRaised(run);
            });

            assert.strictEqual(raised, 0);
        });
    }
}
