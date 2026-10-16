// Builds NetFlow v9 (RFC 3954) and IPFIX (RFC 7011) messages for the tests

const u16 = value => {
    const buffer = Buffer.alloc(2);
    buffer.writeUInt16BE(value, 0);
    return buffer;
};

const fields = list => Buffer.concat(list.map(([type, length]) => Buffer.concat([u16(type), u16(length)])));

// A set or flowset: its id, its length including this 4-byte header, the body, then zero padding
const set = (id, body, padding = 0) => Buffer.concat([u16(id), u16(4 + body.length + padding), body, Buffer.alloc(padding)]);

const templateRecord = (templateId, list) => Buffer.concat([u16(templateId), u16(list.length), fields(list)]);

// An IPFIX template withdrawal (RFC 7011 section 8.1): the template id and a field count of 0, nothing else
const withdrawal = templateId => Buffer.concat([u16(templateId), u16(0)]);

const ipfixOptionsTemplateRecord = (templateId, scope, list) => Buffer.concat([
    u16(templateId), u16(scope.length + list.length), u16(scope.length), fields([...scope, ...list]),
]);

// The observation domain scopes the templates (RFC 7011 Observation Domain ID, RFC 3954 Source ID)
const ipfixMessage = (sets, observationDomainId = 0) => {
    const body = Buffer.concat(sets);
    const header = Buffer.alloc(16);
    header.writeUInt16BE(10, 0);
    header.writeUInt16BE(header.length + body.length, 2);
    header.writeUInt32BE(observationDomainId, 12);
    return Buffer.concat([header, body]);
};

const netflow9Message = (sets, sourceId = 0) => {
    const header = Buffer.alloc(20);
    header.writeUInt16BE(9, 0);
    header.writeUInt16BE(sets.length, 2);
    header.writeUInt32BE(sourceId, 16);
    return Buffer.concat([header, ...sets]);
};

// Source address, destination address and octets: a 12-byte record
const FLOW_FIELDS = [[8, 4], [12, 4], [1, 4]];
const flowRecords = count => Buffer.concat(Array.from({ length: count }, (_, index) => {
    const record = Buffer.alloc(12);
    record.writeUInt32BE(0xc0000201 + index, 0); // 192.0.2.1, 192.0.2.2, ...
    record.writeUInt32BE(0xc6336401, 4); // 198.51.100.1
    record.writeUInt32BE(1500, 8);
    return record;
}));

module.exports = {
    fields, set, templateRecord, withdrawal, ipfixOptionsTemplateRecord, ipfixMessage, netflow9Message, FLOW_FIELDS, flowRecords,
};
