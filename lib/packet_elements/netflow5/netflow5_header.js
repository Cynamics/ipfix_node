/**
 * NETFLOW5 STATIC HEADER
 */
 
const SAMPLING_MODE_MASK = 49152;
const SAMPLING_RATE_MASK = 16383;
var Header = function(buffer) {
    var self = this;
    this.Version = undefined;
    this.Count = undefined;
    this.Uptime = undefined;
    this.Seconds = undefined;
    this.NSeconds = undefined;
    this.SequenceNumber = undefined;
    this.EngineType = undefined;
    this.EngineId = undefined;
    this.SamplingMode = undefined;
    this.SamplingRate = undefined;
    this.sizeInBytes = 0;
    var _construct = function() {
        self.Version = buffer.readUInt16BE(0);
        self.Count = buffer.readUInt16BE(2);
        self.Uptime = buffer.readUInt32BE(4);
        self.Seconds = buffer.readUInt32BE(8);
        self.NSeconds = buffer.readUInt32BE(12);
        self.SequenceNumber = buffer.readUInt32BE(16);
        self.EngineType = buffer.readUInt8(20);
        self.EngineId = buffer.readUInt8(21);
        self.SamplingMode = buffer.readUInt16BE(22) & SAMPLING_MODE_MASK;
        self.SamplingRate = buffer.readUInt16BE(22) & SAMPLING_RATE_MASK;
        self.sizeInBytes = 24;
    }
    _construct();

    return this;
};

module.exports = Header;