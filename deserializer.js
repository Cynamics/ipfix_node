var IpfixPacket = require('./lib/packet_elements/ipfix/ipfix_packet');
var Netflow9Packet = require('./lib/packet_elements/netflow9/netflow9_packet');
var Netflow7Packet = require('./lib/packet_elements/netflow7/netflow7_packet');
var Netflow5Packet = require('./lib/packet_elements/netflow5/netflow5_packet');
var TemplateStore = require('./lib/packet_elements/template_store');

const VERSION_IPFIX = 10
const VERSION_NETFLOW9 = 9
const VERSION_NETFLOW7 = 7
const VERSION_NETFLOW5 = 5
const TRANSPORTS = ['udp', 'tcp', 'sctp']

var Deserializer = function (params)
{
    var self = this;
    var defaultConf = {
        parseDataValues: true,
        templateProvider: undefined,
        onNewTemplate: undefined,
        // Called with (templateId, templateType) when an IPFIX exporter withdraws a template, without internal storage; a
        // template id of 2 or 3 withdraws all templates of the kind
        onTemplateWithdrawal: undefined,
        useInternalStorage: true,
        // The transport the messages arrive over: "udp", "tcp" or "sctp". Template withdrawals are honored over TCP and
        // SCTP only: a collector over UDP MUST ignore them (RFC 7011 section 8.4)
        transport: 'udp',
        // The transport session of every message, when deserialize is given none (see deserialize)
        session: undefined,
    }
    this.Storage = require('./lib/storage/template_storage.js');
    this.conf = Object.assign(defaultConf, params);
    // A misspelled transport would turn template withdrawals off without a word: it is read in any case, and checked
    this.conf.transport = this.conf.transport == null ? 'udp' : String(this.conf.transport).trim().toLowerCase();
    if (TRANSPORTS.indexOf(this.conf.transport) < 0)
        throw new Error(`Unsupported transport '${params.transport}': use 'udp', 'tcp' or 'sctp'`);

    // Without the internal storage the caller keeps the templates: checked once here, not on every message
    if (!this.conf.useInternalStorage && typeof this.conf.onNewTemplate !== 'function')
        throw new Error('With useInternalStorage:false, give an onNewTemplate function to store the new templates');

    if (!this.conf.useInternalStorage && typeof this.conf.templateProvider !== 'function')
        throw new Error('With useInternalStorage:false, give a templateProvider function to return the stored templates');

    // With the caller's own storage, the templates and withdrawals whose callback has not settled: the next messages
    // read them before the templateProvider, which may not have caught up yet
    var pending = new Map();

    // session (optional): the transport session the message arrived on, such as the exporter's address and port. The
    // internal storage keeps the templates of each session apart, as RFC 7011 scopes them.
    this.deserialize = function (buffer, session)
    {
        if (!Buffer.isBuffer(buffer) || buffer.byteLength < 2)
            return Promise.reject(new RangeError('A message holds at least its 2-byte version'));

        const version = buffer.readUInt16BE(0);
        switch (version) {
            case VERSION_IPFIX:
                if (typeof IpfixPacket == 'function') {
                    return new Promise(function (resolve, reject)
                    {
                        try {
                            var parseParams = prepareParams(session);
                            parseParams = Object.assign(parseParams, { buffer: buffer });
                            var ParsedPacket = new IpfixPacket(parseParams);
                            resolve(ParsedPacket);
                        } catch (e) {
                            reject(e);
                        }
                    });
                } else {
                    return Promise.reject(
                        new Error('Please provide a template, or tell the developer to provide this script with a default one !')
                    );
                }
                break;
            case VERSION_NETFLOW9:
                if (typeof Netflow9Packet == 'function') {
                    return new Promise(function (resolve, reject)
                    {
                        try {
                            var parseParams = prepareParams(session);
                            parseParams = Object.assign(parseParams, { buffer: buffer });
                            var ParsedPacket = new Netflow9Packet(parseParams);
                            resolve(ParsedPacket);
                        } catch (e) {
                            reject(e);
                        }
                    });
                } else {
                    return Promise.reject(
                        new Error('Please provide a template, or tell the developer to provide this script with a default one !')
                    );
                }
                break;
            case VERSION_NETFLOW7:
                if (typeof Netflow7Packet == 'function') {
                    return new Promise(function (resolve, reject)
                    {
                        try {
                            var ParsedPacket = new Netflow7Packet(buffer);
                            resolve(ParsedPacket);
                        } catch (e) {
                            reject(e);
                        }
                    });
                } else {
                    return Promise.reject(
                        new Error('Please provide a template, or tell the developer to provide this script with a default one !')
                    );
                }
                break;
            case VERSION_NETFLOW5:
                if (typeof Netflow5Packet == 'function') {
                    return new Promise(function (resolve, reject)
                    {
                        try {
                            var ParsedPacket = new Netflow5Packet(buffer);
                            resolve(ParsedPacket);
                        } catch (e) {
                            reject(e);
                        }
                    });
                } else {
                    return Promise.reject(
                        new Error('Please provide a template, or tell the developer to provide this script with a default one !')
                    );
                }
                break;
            default:
                return Promise.reject(
                    new RangeError(`Unsupported sample version: ${version}`)
                );
        }
    };
    var prepareParams = function (session)
    {
        var params = {};
        params = Object.assign(params, self.conf, { session: session !== undefined ? session : self.conf.session, pending: pending });
        // The internal storage is used whenever it is on, a templateProvider given or not, as the packets read it then
        if (self.conf.useInternalStorage)
            params = Object.assign(params, { templates: self.Storage });

        return params;
    }
    // Removes every template of a transport session from the internal storage: call it when a TCP connection or an SCTP
    // association ends, as that withdraws all of its templates (RFC 7011 section 8.1). Without a session, that of the
    // options, as for deserialize.
    this.endSession = function (session)
    {
        TemplateStore.endSession(self.Storage, session !== undefined ? session : self.conf.session);
    };
    return this;
}

module.exports = function (params)
{
    var params = params || {};
    return new Deserializer(params);
}