// Each scenario decodes one or more messages and returns a plain summary. They run in a worker thread
// (decodeWithin), so a decoder that never returns fails the test instead of hanging or exhausting the runner.
const Netflow = require('../../deserializer');
const {
    set, templateRecord, withdrawal, ipfixOptionsTemplateRecord, ipfixMessage, netflow9Message, FLOW_FIELDS, flowRecords,
} = require('./messages');

const summary = packet => ({
    records: packet.DataSets.length,
    templates: packet.TemplateSets.map(template => template.templateId),
    optionsTemplates: packet.OptionsTemplateSets.map(template => template.templateId),
    withdrawals: packet.TemplateWithdrawals,
    skipped: packet.SkippedSets,
});

// The way a caller keeps templates outside the decoder, as flow-shipper does: the callbacks fill a map the
// provider reads
const externalStorage = () => {
    const templates = new Map();
    const calls = { added: [], withdrawn: [] };
    const options = {
        useInternalStorage: false,
        onNewTemplate: template => {
            calls.added.push({ templateId: template.templateId, numberFields: template.numberFields });
            templates.set(template.templateId, template);
        },
        onTemplateWithdrawal: (templateId, templateType) => {
            calls.withdrawn.push({ templateId, templateType });
            templates.delete(templateId);
        },
        templateProvider: templateId => templates.get(templateId),
    };
    return { options, calls };
};

// A template of zero-byte records, as a caller may still hold one from before (no fields, or one of length 0)
const emptyRecordProvider = fieldSpecifiers => ({
    useInternalStorage: false,
    onNewTemplate: () => {},
    templateProvider: templateId => ({ templateId, numberFields: fieldSpecifiers.length, dataRecordSizeInBytes: 0, FieldSpecifiers: fieldSpecifiers }),
});

const scenarios = {
    'ipfix: a withdrawal is reported, and the internal storage, shared by every exporter, keeps the template': async () => {
        const decoder = Netflow();
        const before = await decoder.deserialize(ipfixMessage([set(2, templateRecord(256, FLOW_FIELDS)), set(256, flowRecords(2))]));
        const withdrawn = await decoder.deserialize(ipfixMessage([set(2, withdrawal(256))]));
        const after = await decoder.deserialize(ipfixMessage([set(256, flowRecords(2))]));
        return { before: summary(before), withdrawn: summary(withdrawn), after: summary(after) };
    },
    'ipfix: a withdrawal of all templates is passed on with the set id': async () => {
        const { options, calls } = externalStorage();
        const packet = await Netflow(options).deserialize(ipfixMessage([set(2, withdrawal(2)), set(3, withdrawal(3))]));
        return { calls, packet: summary(packet) };
    },
    'ipfix: a record of no field and a reserved id other than the set id is ignored': async () => summary(
        await Netflow().deserialize(ipfixMessage([set(2, withdrawal(100)), set(3, withdrawal(4))]))
    ),
    'ipfix: a withdrawal callback that throws or rejects leaves the message read': async () => {
        const { options } = externalStorage();
        options.onTemplateWithdrawal = templateId => {
            if (templateId === 256) {
                throw new Error('storage down');
            }

            return Promise.reject(new Error('storage down'));
        };
        const decoder = Netflow(options);
        const packet = await decoder.deserialize(ipfixMessage([
            set(2, templateRecord(258, FLOW_FIELDS)), set(2, Buffer.concat([withdrawal(256), withdrawal(257)])), set(258, flowRecords(2)),
        ]));
        await new Promise(resolve => setImmediate(resolve)); // the rejection is noted once it settles
        return summary(packet);
    },
    'ipfix: the internal storage is used when a templateProvider is also given': async () => summary(
        await Netflow({ templateProvider: () => undefined }).deserialize(ipfixMessage([
            set(2, templateRecord(265, FLOW_FIELDS)), set(265, flowRecords(2)), set(2, withdrawal(265)),
        ]))
    ),
    'ipfix: records of a variable-length field are framed by their own length prefix': async () => {
        // An interface name of variable length (IE 82), then octets
        const record = name => {
            const value = Buffer.from(name);
            const prefix = value.length < 255 ? Buffer.from([value.length]) : Buffer.from([255, value.length >> 8, value.length & 0xff]);
            return Buffer.concat([prefix, value, Buffer.from([0, 0, 5, 220])]);
        };
        const packet = await Netflow().deserialize(ipfixMessage([
            set(2, templateRecord(400, [[82, 0xffff], [1, 4]])),
            set(400, Buffer.concat([record('eth0'), record('ge-0/0/12'), record('x'.repeat(300))])),
        ]));
        return packet.DataSets.map(flow => ({
            sizeInBytes: flow.sizeInBytes, nameBytes: flow.Fields[0].sizeInBytes, octets: flow.Fields[1].fieldValueParsed,
        }));
    },
    'ipfix: a templateProvider returning null leaves its data set unread and the message read': async () => {
        const { options } = externalStorage();
        const provide = options.templateProvider;
        options.templateProvider = templateId => (templateId === 256 ? null : provide(templateId));
        return summary(await Netflow(options).deserialize(ipfixMessage([
            set(256, flowRecords(2)), set(2, templateRecord(257, FLOW_FIELDS)), set(257, flowRecords(3)),
        ])));
    },
    'ipfix: a withdrawal reaches onTemplateWithdrawal, never onNewTemplate': async () => {
        const { options, calls } = externalStorage();
        const decoder = Netflow(options);
        await decoder.deserialize(ipfixMessage([set(2, templateRecord(256, FLOW_FIELDS))]));
        const packet = await decoder.deserialize(ipfixMessage([set(2, withdrawal(256)), set(256, flowRecords(3))]));
        return { calls, packet: summary(packet) };
    },
    'ipfix: an options template withdrawal is read as 4 bytes, the next record stays aligned': async () => {
        const decoder = Netflow();
        const packet = await decoder.deserialize(ipfixMessage([
            set(3, Buffer.concat([withdrawal(300), ipfixOptionsTemplateRecord(301, [[149, 4]], [[34, 4]])])),
        ]));
        return summary(packet);
    },
    'ipfix: a template of zero-byte records is not stored, and its data set ends': async () => {
        const { options, calls } = externalStorage();
        const decoder = Netflow(options);
        const packet = await decoder.deserialize(ipfixMessage([set(2, templateRecord(256, [[210, 0]])), set(256, flowRecords(2))]));
        return { calls, packet: summary(packet) };
    },
    'ipfix: a data set of a provided template with no fields ends': async () => summary(
        await Netflow(emptyRecordProvider([])).deserialize(ipfixMessage([set(256, flowRecords(4))]))
    ),
    'ipfix: a data set of a provided template of a zero-length field ends': async () => summary(
        await Netflow(emptyRecordProvider([{ fieldId: 210, fieldLength: 0 }])).deserialize(ipfixMessage([set(256, flowRecords(4))]))
    ),
    'ipfix: an empty set of an unknown id is stepped over': async () => summary(
        await Netflow().deserialize(ipfixMessage([set(4, Buffer.alloc(0)), set(2, templateRecord(257, FLOW_FIELDS)), set(257, flowRecords(2))]))
    ),
    'ipfix: a set of an unknown id is stepped over whole': async () => summary(
        await Netflow().deserialize(ipfixMessage([set(100, Buffer.alloc(8, 0xff)), set(2, templateRecord(258, FLOW_FIELDS)), set(258, flowRecords(2))]))
    ),
    'ipfix: trailing zero bytes end the message': async () => summary(
        await Netflow().deserialize(ipfixMessage([set(2, templateRecord(259, FLOW_FIELDS)), set(259, flowRecords(2)), Buffer.alloc(4)]))
    ),
    'ipfix: a set shorter than its header ends the message': async () => summary(
        await Netflow().deserialize(ipfixMessage([set(2, templateRecord(260, FLOW_FIELDS)), set(260, flowRecords(1)), Buffer.from([0x01, 0x05, 0x00, 0x02])]))
    ),
    'ipfix: padding shorter than a record ends a template set': async () => summary(
        await Netflow().deserialize(ipfixMessage([set(2, templateRecord(261, FLOW_FIELDS), 2), set(261, flowRecords(1))]))
    ),
    'netflow9: a templateProvider returning null leaves its flowset unread and the message read': async () => {
        const { options } = externalStorage();
        const provide = options.templateProvider;
        options.templateProvider = templateId => (templateId === 256 ? null : provide(templateId));
        return summary(await Netflow(options).deserialize(netflow9Message([
            set(256, flowRecords(2)), set(0, templateRecord(257, FLOW_FIELDS)), set(257, flowRecords(3)),
        ])));
    },
    'netflow9: a template of no fields is not stored': async () => {
        const { options, calls } = externalStorage();
        const packet = await Netflow(options).deserialize(netflow9Message([set(0, templateRecord(256, [])), set(256, flowRecords(2))]));
        return { calls, packet: summary(packet) };
    },
    'netflow9: a data flowset of a provided template of zero-byte records ends': async () => summary(
        await Netflow(emptyRecordProvider([{ fieldId: 8, fieldLength: 0 }])).deserialize(netflow9Message([set(256, flowRecords(4))]))
    ),
    'netflow9: an empty flowset of an unknown id is stepped over': async () => summary(
        await Netflow().deserialize(netflow9Message([set(2, Buffer.alloc(0)), set(0, templateRecord(262, FLOW_FIELDS)), set(262, flowRecords(2))]))
    ),
    'netflow9: trailing zero bytes end the message': async () => summary(
        await Netflow().deserialize(netflow9Message([set(0, templateRecord(263, FLOW_FIELDS)), set(263, flowRecords(2)), Buffer.alloc(4)]))
    ),
    'netflow9: the padding that ends a template flowset is not read as a record': async () => summary(
        await Netflow().deserialize(netflow9Message([set(0, templateRecord(264, FLOW_FIELDS), 2), set(264, flowRecords(1))]))
    ),
};

module.exports = scenarios;
