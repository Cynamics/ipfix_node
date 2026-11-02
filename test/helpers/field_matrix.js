// Decodes one field of every data type at every length the field specifier treats apart, in both protocols, with and
// without parsed values: test/fixtures/decoded_fields.json holds what that gave before the field parsing changed

const Netflow = require('../../deserializer');
const ENTITIES = require('../../static/ipfix_entities');
const { set, templateRecord, ipfixMessage, netflow9Message } = require('./messages');

const TEMPLATE_ID = 256;
const LENGTHS = [1, 2, 3, 4, 6, 8, 16, 32];
const UNKNOWN_FIELD = 32000; // no entity describes it, and below 32768, where IPFIX reads an enterprise field

// The first field of each data type in the entities, then the field no entity describes
const fieldIds = () => {
    const firstOfType = new Map();
    for (const id of Object.keys(ENTITIES).filter(key => /^\d+$/.test(key)).map(Number).sort((a, b) => a - b)) {
        if (!firstOfType.has(ENTITIES[id].DataType)) {
            firstOfType.set(ENTITIES[id].DataType, id);
        }
    }

    if (UNKNOWN_FIELD in ENTITIES) {
        throw new Error(`Field ${UNKNOWN_FIELD} has an entity now: pick another`);
    }

    return [...firstOfType.values(), UNKNOWN_FIELD];
};

// The first record's last byte is 1, so a Boolean field of one byte reads true
const valueOf = (recordIndex, length) => Buffer.from(Array.from({ length }, (_, index) => (
    recordIndex === 0 && index === length - 1 ? 1 : (recordIndex * 37 + index * 11 + 200) % 256
)));

const PROTOCOLS = { netflow9: netflow9Message, ipfix: ipfixMessage };

async function decodeAtLength(message, ids, length, parseDataValues, around = run => run()) {
    const list = ids.map(id => [id, length]);
    const records = [0, 1].flatMap(recordIndex => ids.map(() => valueOf(recordIndex, length)));
    const decoder = Netflow({ parseDataValues });
    await decoder.deserialize(message([set(message === ipfixMessage ? 2 : 0, templateRecord(TEMPLATE_ID, list))]));
    let packet;
    await around(async () => {
        packet = await decoder.deserialize(message([set(TEMPLATE_ID, Buffer.concat(records))]));
    });
    return packet.DataSets.flatMap((record, recordIndex) => record.Fields.map(field => [
        `${field.fieldId}/${length}/${recordIndex}`,
        { fieldValue: field.fieldValue, fieldValueParsed: field.fieldValueParsed, sizeInBytes: field.sizeInBytes },
    ]));
}

async function decodeMatrix() {
    const ids = fieldIds();
    const matrix = {};
    for (const [name, message] of Object.entries(PROTOCOLS)) {
        for (const parseDataValues of [true, false]) {
            const entries = [];
            for (const length of LENGTHS) {
                entries.push(...await decodeAtLength(message, ids, length, parseDataValues));
            }

            matrix[`${name}, parseDataValues ${parseDataValues}`] = Object.fromEntries(entries);
        }
    }

    return matrix;
}

if (require.main === module) {
    const path = require('node:path');
    decodeMatrix().then(matrix => require('node:fs').writeFileSync(
        path.join(__dirname, '..', 'fixtures', 'decoded_fields.json'), `${JSON.stringify(matrix, null, 1)}\n`,
    ));
}

module.exports = { decodeMatrix, decodeAtLength, fieldIds, PROTOCOLS };
