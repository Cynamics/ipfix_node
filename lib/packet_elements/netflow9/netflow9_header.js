/**
 * NETFLOW9 STATIC HEADER
 */

var Header = function(buffer) {
    var self = this;
    this.Version = undefined;
    this.Count = undefined;
    this.Uptime = undefined;
    this.Seconds = undefined;
    this.SequenceNumber = undefined;
    this.SourceId = undefined;
    this.sizeInBytes = 0;
    var _construct = function() {
        self.Version = buffer.readUInt16BE(0);
        self.Count = buffer.readUInt16BE(2);
        self.Uptime = buffer.readUInt32BE(4);
        self.Seconds = buffer.readUInt32BE(8);
        self.SequenceNumber = buffer.readUInt32BE(12);
        self.SourceId = buffer.readUInt32BE(16);
        self.sizeInBytes = 20;
    }
    _construct();

    return this;
};

module.exports = Header;