var Netflow5Header = require('./netflow5_header');
var ByteParser = require('../../utils/byte_parsers');

const NETFLOW5_FLOW_SIZE = 48;

var NetflowPacket = function (buffer) {
    var self = this;
    this.Header = undefined;
    this.DataSets = [];
    var _construct = function (buffer) {
        self.Header = new Netflow5Header(buffer);
        buffer = buffer.slice(self.Header.sizeInBytes);
        while (buffer.byteLength >= NETFLOW5_FLOW_SIZE) {
            self.DataSets.push({
                ipv4_src_addr: ByteParser.parseByType("ipv4Address", buffer.readUInt32BE(0)),
                ipv4_dst_addr: ByteParser.parseByType("ipv4Address", buffer.readUInt32BE(4)),
                ipv4_next_hop: ByteParser.parseByType("ipv4Address", buffer.readUInt32BE(8)),
                input_snmp: buffer.readUInt16BE(12),
                output_snmp: buffer.readUInt16BE(14),
                in_pkts: buffer.readUInt32BE(16),
                in_bytes: buffer.readUInt32BE(20),
                first_switched: buffer.readUInt32BE(24),
                last_switched: buffer.readUInt32BE(28),
                ipv4_src_port: buffer.readUInt16BE(32),
                ipv4_dst_port: buffer.readUInt16BE(34),
                tcp_flags: buffer.readUInt8(37),
                protocol: buffer.readUInt8(38),
                src_tos: buffer.readUInt8(39),
                in_as: buffer.readUInt16BE(40),
                out_as: buffer.readUInt16BE(42),
                src_mask: buffer.readUInt8(44),
                dst_mask: buffer.readUInt8(45)
            });
            buffer = buffer.slice(NETFLOW5_FLOW_SIZE);
        }
    }
    _construct(buffer);
    return this;
}

NetflowPacket.prototype.NetflowHeader = Netflow5Header;
module.exports = NetflowPacket;