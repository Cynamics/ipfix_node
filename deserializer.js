var IpfixPacket = require('./lib/packet_elements/ipfix/ipfix_packet');
var Netflow9Packet = require('./lib/packet_elements/netflow9/netflow9_packet');
var Netflow7Packet = require('./lib/packet_elements/netflow7/netflow7_packet');
var Netflow5Packet = require('./lib/packet_elements/netflow5/netflow5_packet');

const VERSION_IPFIX = 10
const VERSION_NETFLOW9 = 9
const VERSION_NETFLOW7 = 7
const VERSION_NETFLOW5 = 5

var Deserializer = function (params) {
    var self = this;
    var defaultConf = {
        parseDataValues: true,
        templateProvider: undefined,
        onNewTemplate: undefined,
        useInternalStorage: true,
    }
    this.Storage = require('./lib/storage/template_storage.js');
    this.conf = Object.assign(defaultConf, params);
    this.deserialize = function (buffer) {
        const version = buffer.readUInt16BE(0);
        switch (version) {
            case VERSION_IPFIX:
                if (typeof IpfixPacket == 'function') {
                    return new Promise(function (resolve, reject) {
                        try {
                            var parseParams = prepareParams();
                            parseParams = Object.assign(parseParams, { buffer: buffer });
                            var ParsedPacket = new IpfixPacket(parseParams);
                            resolve(ParsedPacket);
                        } catch (e) {
                            reject(e);
                        }
                    });
                } else {
                    return console.error('Please provide a template, or tell the developer to provide this script with a default one !');
                }
                break;
            case VERSION_NETFLOW9:
                if (typeof Netflow9Packet == 'function') {
                    return new Promise(function (resolve, reject) {
                        try {
                            var parseParams = prepareParams();
                            parseParams = Object.assign(parseParams, { buffer: buffer });
                            var ParsedPacket = new Netflow9Packet(parseParams);
                            resolve(ParsedPacket);
                        } catch (e) {
                            reject(e);
                        }
                    });
                } else {
                    return console.error('Please provide a template, or tell the developer to provide this script with a default one !');
                }
                break;
            case VERSION_NETFLOW7:
                if (typeof Netflow7Packet == 'function') {
                    return new Promise(function (resolve, reject) {
                        try {
                            var ParsedPacket = new Netflow7Packet(buffer);
                            resolve(ParsedPacket);
                        } catch (e) {
                            reject(e);
                        }
                    });
                } else {
                    return console.error('Please provide a template, or tell the developer to provide this script with a default one !');
                }
                break;
            case VERSION_NETFLOW5:
                if (typeof Netflow5Packet == 'function') {
                    return new Promise(function (resolve, reject) {
                        try {
                            var ParsedPacket = new Netflow5Packet(buffer);
                            resolve(ParsedPacket);
                        } catch (e) {
                            reject(e);
                        }
                    });
                } else {
                    return console.error('Please provide a template, or tell the developer to provide this script with a default one !');
                }
                break;
            default:
                console.error("Version unsupported!");
                return new Promise(function (resolve, reject) {
                    reject(new RangeError("Unsupported sample version"));
                });
        }
    };
    var prepareParams = function () {
        var params = {};
        params = Object.assign(params, self.conf);
        if (typeof self.conf.templateProvider == 'undefined')
            params = Object.assign(params, { templates: self.Storage });

        return params;
    }
    var getStorageByType = function (type) {
        if (type == 'DataTemplate')
            return Storage.DataTemplateMap;
        else if (type == 'OptionsTemplate')
            return Storage.OptionsTemplateMap;
    }
    return this;
}

module.exports = function (params) {
    var params = params || {};
    return new Deserializer(params);
}