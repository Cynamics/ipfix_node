const test = require('node:test');
const assert = require('node:assert');
const { decodeMatrix } = require('./helpers/field_matrix');
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
