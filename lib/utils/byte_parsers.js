var SUPPORTED_TYPES = [
    'String',
    'ipv4Address',
    'ipv6Address',
    'Boolean',
    'Hex',
    'macAddress',
    'unsigned64',
    'unsigned16',
    'unsigned32',
    'unsigned8'
];
var ipv6 = require('ip-address').Address6;
var ByteParser = function ()
{
    var self = this;
    this.parseByType = function (type, int)
    {
        if (SUPPORTED_TYPES.includes(type)) {
            if (type == 'String')
                return self.String(int);
            else if (type == 'ipv4Address')
                return self.ipv4Address(int);
            else if (type == 'ipv6Address')
                return self.ipv6Address(int);
            else if (type == 'Boolean')
                return self.Boolean(int);
            else if (type == 'Hex') {
                return self.Hex(int);
            }
            else if (type == "macAddress") {
                return self.macAddress(int);
            }
            else if (type == 'unsigned64') {
                return self.BigNum(int);
            }
            else if (type == 'unsigned16') {
                return int & 0xFFFF;
            }
            else if (type === 'unsigned32') {
                return int >>> 0;
            }
            else if (type === 'unsigned8') {
                return int & 0xFF; // Mask to ensure it’s an 8-bit unsigned integer
            }
        } else {
            throw new Error(`Parsing by type '${type}' not supported : `)
        }
    }
    this.String = function (buffer)
    {
        return null;
    };

    this.ipv4Address = function (int)
    {
        var part1 = int & 255;
        var part2 = ((int >> 8) & 255);
        var part3 = ((int >> 16) & 255);
        var part4 = ((int >> 24) & 255);

        return part4 + "." + part3 + "." + part2 + "." + part1;
    };

    this.ipv6Address = function (uint8Array)
    {
        return ipv6.fromUnsignedByteArray(uint8Array).address;
    };

    this.macAddress = function (buffer)
    {
        return buffer.toString('hex').match(/.{1,2}/g).join(':');
    };

    this.Boolean = function (buffer)
    {
        return (buffer == 1);
    };

}


module.exports = new ByteParser();