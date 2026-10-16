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
// provider reads. more: further deserializer options, such as the transport
const externalStorage = (more = {}) => {
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
        ...more,
    };
    return { options, calls };
};

// A template of zero-byte records, as a caller may still hold one from before (no fields, or one of length 0)
const emptyRecordProvider = fieldSpecifiers => ({
    useInternalStorage: false,
    onNewTemplate: () => {},
    templateProvider: templateId => ({ templateId, numberFields: fieldSpecifiers.length, dataRecordSizeInBytes: 0, FieldSpecifiers: fieldSpecifiers }),
});

// Template withdrawals are honored over TCP and SCTP only: over UDP a collector MUST ignore them (RFC 7011 section 8.4)
const TCP = { transport: 'tcp' };

const fieldIds = flow => flow.Fields.map(field => field.fieldId);

const scenarios = {
    'ipfix: templates of one id in two observation domains are kept apart': async () => {
        const decoder = Netflow();
        await decoder.deserialize(ipfixMessage([set(2, templateRecord(256, FLOW_FIELDS))], 1));
        await decoder.deserialize(ipfixMessage([set(2, templateRecord(256, [[8, 4], [12, 4]]))], 2));
        const first = await decoder.deserialize(ipfixMessage([set(256, flowRecords(2))], 1)); // 24 bytes: 2 records of 12
        const second = await decoder.deserialize(ipfixMessage([set(256, flowRecords(2))], 2)); // 24 bytes: 3 records of 8
        return { first: summary(first), second: summary(second) };
    },
    'ipfix: a withdrawal removes the template from its observation domain only': async () => {
        const decoder = Netflow(TCP);
        await decoder.deserialize(ipfixMessage([set(2, templateRecord(256, FLOW_FIELDS))], 1));
        await decoder.deserialize(ipfixMessage([set(2, templateRecord(256, FLOW_FIELDS))], 2));
        const withdrawn = await decoder.deserialize(ipfixMessage([set(2, withdrawal(256))], 1));
        const first = await decoder.deserialize(ipfixMessage([set(256, flowRecords(2))], 1));
        const second = await decoder.deserialize(ipfixMessage([set(256, flowRecords(2))], 2));
        return { withdrawn: summary(withdrawn), first: summary(first), second: summary(second) };
    },
    'ipfix: a withdrawal of all templates removes those of its observation domain only': async () => {
        const decoder = Netflow(TCP);
        await decoder.deserialize(ipfixMessage([set(2, Buffer.concat([templateRecord(256, FLOW_FIELDS), templateRecord(257, FLOW_FIELDS)]))], 1));
        await decoder.deserialize(ipfixMessage([set(2, templateRecord(256, FLOW_FIELDS))], 2));
        await decoder.deserialize(ipfixMessage([set(2, withdrawal(2))], 1));
        const first = await decoder.deserialize(ipfixMessage([set(256, flowRecords(2)), set(257, flowRecords(2))], 1));
        const second = await decoder.deserialize(ipfixMessage([set(256, flowRecords(2))], 2));
        return { first: summary(first), second: summary(second) };
    },
    'ipfix: a withdrawal of all templates is passed on with the set id': async () => {
        const { options, calls } = externalStorage(TCP);
        const packet = await Netflow(options).deserialize(ipfixMessage([set(2, withdrawal(2)), set(3, withdrawal(3))]));
        return { calls, packet: summary(packet) };
    },
    'ipfix: a record of no field and a reserved id other than the set id is listed': async () => summary(
        await Netflow().deserialize(ipfixMessage([set(2, withdrawal(100)), set(3, withdrawal(4))]))
    ),
    'ipfix: a withdrawal callback that throws or rejects leaves the message read': async () => {
        const { options } = externalStorage(TCP);
        options.onTemplateWithdrawal = templateId => {
            if (templateId === 256) {
                throw new Error('storage down');
            }

            // Rejects after the packet is returned: only its settled promise tells when the error is there
            return new Promise((resolve, reject) => setTimeout(() => reject(new Error('storage down')), 20));
        };
        const decoder = Netflow(options);
        const packet = await decoder.deserialize(ipfixMessage([
            set(2, Buffer.concat([templateRecord(256, FLOW_FIELDS), templateRecord(257, FLOW_FIELDS), templateRecord(258, FLOW_FIELDS)])),
            set(2, Buffer.concat([withdrawal(256), withdrawal(257)])),
            set(258, flowRecords(2)),
        ]));
        await Promise.all(packet.TemplateWithdrawals.map(withdrawn => withdrawn.settled));
        return summary(packet);
    },
    'ipfix: the internal storage is used when a templateProvider is also given': async () => summary(
        await Netflow({ ...TCP, templateProvider: () => undefined }).deserialize(ipfixMessage([
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
        const { options, calls } = externalStorage(TCP);
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
    'ipfix: a set running past the end of the message keeps the records decoded before it': async () => summary(
        await Netflow().deserialize(ipfixMessage([
            set(2, templateRecord(270, FLOW_FIELDS)), set(270, flowRecords(2)), Buffer.concat([Buffer.from([0, 2, 0, 20]), Buffer.alloc(4, 1)]),
        ]))
    ),
    'ipfix: a data set running past the end of the message keeps its whole records': async () => {
        const data = set(270, flowRecords(5));
        return summary(await Netflow().deserialize(ipfixMessage([set(2, templateRecord(270, FLOW_FIELDS)), data.slice(0, 4 + 12 * 2 + 6)])));
    },
    'ipfix: an options template record shorter than its header ends the set': async () => summary(
        await Netflow().deserialize(ipfixMessage([
            set(2, templateRecord(271, FLOW_FIELDS)), set(271, flowRecords(2)), set(3, Buffer.from([0x01, 0x10, 0x00, 0x01, 0x00])),
        ]))
    ),
    'ipfix: a variable-length value of 0 bytes is read, one cut short ends the set': async () => {
        const record = (length, value) => Buffer.concat([Buffer.from([length]), value, Buffer.from([0, 0, 5, 220])]);
        // The shortest record is 5 bytes (a 1-byte prefix and the octets): the 6 bytes after the first record are one,
        // whose prefix gives a name of 20 bytes
        const packet = await Netflow().deserialize(ipfixMessage([
            set(2, templateRecord(401, [[82, 0xffff], [1, 4]])),
            set(401, Buffer.concat([record(0, Buffer.alloc(0)), Buffer.from([20, 0x61, 0x62, 0x63, 0x64, 0x65])])),
        ]));
        return {
            records: packet.DataSets.map(flow => ({ sizeInBytes: flow.sizeInBytes, nameBytes: flow.Fields[0].sizeInBytes, octets: flow.Fields[1].fieldValueParsed })),
            skipped: packet.SkippedSets,
        };
    },
    'ipfix: a provided template of unreadable field lengths is reported as malformed': async () => summary(
        await Netflow({ useInternalStorage: false, onNewTemplate: () => {}, templateProvider: templateId => ({ templateId, FieldSpecifiers: [{ fieldId: 8 }] }) })
            .deserialize(ipfixMessage([set(256, flowRecords(1))]))
    ),
    'netflow9: a provided template without a record size is reported as malformed': async () => summary(
        await Netflow({ useInternalStorage: false, onNewTemplate: () => {}, templateProvider: templateId => ({ templateId, FieldSpecifiers: [{ fieldId: 8, fieldLength: 4 }] }) })
            .deserialize(netflow9Message([set(256, flowRecords(1))]))
    ),
    'netflow9: a flowset running past the end of the message keeps the records decoded before it': async () => summary(
        await Netflow().deserialize(netflow9Message([
            set(0, templateRecord(272, FLOW_FIELDS)), set(272, flowRecords(2)), Buffer.concat([Buffer.from([0, 0, 0, 20]), Buffer.alloc(4, 1)]),
        ]))
    ),
    'netflow9: a field of 65535 bytes is not read as a variable-length field': async () => summary(
        await Netflow().deserialize(netflow9Message([set(0, templateRecord(273, [[8, 4], [82, 65535]])), set(273, flowRecords(2))]))
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
    'ipfix: a withdrawal received over UDP is ignored and listed': async () => {
        const internal = Netflow();
        await internal.deserialize(ipfixMessage([set(2, templateRecord(256, FLOW_FIELDS))]));
        const stored = await internal.deserialize(ipfixMessage([set(2, Buffer.concat([withdrawal(256), withdrawal(2)])), set(256, flowRecords(2))]));
        const { options, calls } = externalStorage();
        const external = Netflow(options);
        await external.deserialize(ipfixMessage([set(2, templateRecord(256, FLOW_FIELDS))]));
        const kept = await external.deserialize(ipfixMessage([set(2, withdrawal(256)), set(256, flowRecords(2))]));
        return { stored: summary(stored), kept: summary(kept), calls };
    },
    'ipfix: a withdrawal of all templates leaves the NetFlow v9 templates of the same domain id': async () => {
        const decoder = Netflow(TCP);
        await decoder.deserialize(netflow9Message([set(0, templateRecord(400, FLOW_FIELDS))]));
        await decoder.deserialize(ipfixMessage([set(2, templateRecord(400, FLOW_FIELDS))]));
        const withdrawn = await decoder.deserialize(ipfixMessage([set(2, withdrawal(2)), set(400, flowRecords(2))]));
        const netflow9 = await decoder.deserialize(netflow9Message([set(400, flowRecords(2))]));
        return { withdrawn: summary(withdrawn), netflow9: summary(netflow9) };
    },
    'ipfix: templates of one id from two transport sessions are kept apart': async () => {
        const decoder = Netflow(TCP);
        const [first, second] = ['192.0.2.1:4739', '[2001:db8::1]:4739'];
        await decoder.deserialize(ipfixMessage([set(2, templateRecord(256, FLOW_FIELDS))]), first);
        await decoder.deserialize(ipfixMessage([set(2, templateRecord(256, [[8, 4], [12, 4]]))]), second);
        const before = await decoder.deserialize(ipfixMessage([set(256, flowRecords(2))]), first); // 24 bytes: 2 records of 12
        await decoder.deserialize(ipfixMessage([set(2, withdrawal(2))]), second);
        const after = await decoder.deserialize(ipfixMessage([set(256, flowRecords(2))]), first);
        const withdrawn = await decoder.deserialize(ipfixMessage([set(256, flowRecords(2))]), second);
        const unscoped = await decoder.deserialize(ipfixMessage([set(256, flowRecords(2))]));
        return { before: summary(before), after: summary(after), withdrawn: summary(withdrawn), unscoped: summary(unscoped) };
    },
    'ipfix: a template callback that throws or rejects leaves the message read': async () => {
        const { options } = externalStorage();
        const store = options.onNewTemplate;
        options.onNewTemplate = template => {
            if (template.templateId === 256) {
                throw new Error('storage down');
            }

            if (template.templateId === 257) {
                // Rejects after the packet is returned: only its settled promise tells when the error is there
                return new Promise((resolve, reject) => setTimeout(() => reject(new Error('storage down')), 20));
            }

            return store(template);
        };
        const packet = await Netflow(options).deserialize(ipfixMessage([
            set(2, Buffer.concat([templateRecord(256, FLOW_FIELDS), templateRecord(257, FLOW_FIELDS), templateRecord(258, FLOW_FIELDS)])),
            set(258, flowRecords(2)),
        ]));
        await Promise.all(packet.TemplateSets.map(template => template.settled));
        return { ...summary(packet), errors: packet.TemplateSets.map(template => template.error) };
    },
    'ipfix: zero padding after the records of a data set is not read': async () => {
        const named = Buffer.concat([Buffer.from([0, 0, 5, 220]), Buffer.from([4]), Buffer.from('eth0')]);
        return summary(await Netflow().deserialize(ipfixMessage([
            set(2, Buffer.concat([templateRecord(300, FLOW_FIELDS), templateRecord(301, [[1, 4], [82, 0xffff]])])),
            set(300, flowRecords(2), 4), // 4 bytes, shorter than a record of 12
            set(301, named, 3), // 3 bytes, shorter than the shortest record: the octets and a 1-byte prefix
        ])));
    },
    'ipfix: a template id redefined with the other kind replaces the template': async () => {
        const decoder = Netflow();
        const optionsRecord = Buffer.alloc(8);
        optionsRecord.writeUInt32BE(7, 0);
        optionsRecord.writeUInt32BE(100, 4);
        const options = ipfixOptionsTemplateRecord(500, [[149, 4]], [[34, 4]]);
        await decoder.deserialize(ipfixMessage([set(2, templateRecord(500, FLOW_FIELDS))], 1));
        await decoder.deserialize(ipfixMessage([set(3, options)], 1));
        await decoder.deserialize(ipfixMessage([set(3, options)], 2));
        await decoder.deserialize(ipfixMessage([set(2, templateRecord(500, FLOW_FIELDS))], 2));
        const toOptions = await decoder.deserialize(ipfixMessage([set(500, optionsRecord)], 1));
        const toData = await decoder.deserialize(ipfixMessage([set(500, flowRecords(1))], 2));
        return { toOptions: toOptions.DataSets.map(fieldIds), toData: toData.DataSets.map(fieldIds) };
    },
    'ipfix: the templateProvider is called with the packet as this': async () => {
        const calls = [];
        const decoder = Netflow({
            useInternalStorage: false,
            onNewTemplate: () => {},
            templateProvider: function (templateId) {
                calls.push({ templateId, version: this.Header.Version, domain: this.Header.ObservationDomainId ?? this.Header.SourceId });
                return undefined;
            },
        });
        await decoder.deserialize(ipfixMessage([set(256, flowRecords(1))], 7));
        await decoder.deserialize(netflow9Message([set(257, flowRecords(1))], 8));
        return calls;
    },
    'ipfix: a data set of an unknown template is listed': async () => summary(
        await Netflow().deserialize(ipfixMessage([set(256, flowRecords(2))]))
    ),
    'netflow9: a data flowset of an unknown template is listed': async () => summary(
        await Netflow().deserialize(netflow9Message([set(256, flowRecords(2))]))
    ),
    'ipfix: a template of a reserved id is listed': async () => {
        const { options, calls } = externalStorage();
        const packet = await Netflow(options).deserialize(ipfixMessage([
            set(2, templateRecord(100, FLOW_FIELDS)), set(3, ipfixOptionsTemplateRecord(255, [[149, 4]], [[34, 4]])),
        ]));
        return { calls, packet: summary(packet) };
    },
    'netflow9: a template of a reserved id is listed': async () => {
        const { options, calls } = externalStorage();
        const packet = await Netflow(options).deserialize(netflow9Message([set(0, templateRecord(100, FLOW_FIELDS))]));
        return { calls, packet: summary(packet) };
    },
    'ipfix: a withdrawal of a template not stored is ignored and listed': async () => {
        const internal = await Netflow(TCP).deserialize(ipfixMessage([
            set(2, Buffer.concat([withdrawal(256), templateRecord(258, FLOW_FIELDS)])),
            set(3, withdrawal(258)), // 258 is a template, not an options template
            set(258, flowRecords(1)),
        ]));
        const { options, calls } = externalStorage(TCP);
        const external = await Netflow(options).deserialize(ipfixMessage([set(2, withdrawal(257))]));
        return { internal: summary(internal), external: summary(external), calls };
    },
    'ipfix: an options template of zero-byte records is not stored': async () => summary(
        await Netflow().deserialize(ipfixMessage([set(3, ipfixOptionsTemplateRecord(256, [[149, 0]], [])), set(256, flowRecords(1))]))
    ),
    'netflow9: an options template of zero-byte records is not stored': async () => {
        // Template id, then the scope and option lengths in bytes (RFC 3954 section 6.1): one scope field of length 0
        const head = Buffer.from([0x01, 0x00, 0x00, 0x04, 0x00, 0x00]);
        return summary(await Netflow().deserialize(netflow9Message([
            set(1, Buffer.concat([head, Buffer.from([0x00, 0x01, 0x00, 0x00])])), set(256, flowRecords(1)),
        ])));
    },
};

module.exports = scenarios;
