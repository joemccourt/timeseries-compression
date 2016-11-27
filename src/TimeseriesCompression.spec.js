/* eslint-env jasmine */
const TimeseriesCompression = require('./TimeseriesCompression');
const BinBuffer = require('binary-ring-buffer');

let compression = new TimeseriesCompression();
describe('timeseries compression', () => {
    it('timestamp series of constant interval', () => {
        let t0 = new Date().getTime();

        // Single zero bit for constant interval
        let encoded = compression.encodeTS(t0, t0 - 60, t0 - 120);
        expect(encoded).toEqual([0, 1]);
    });

    it('timestamp series can encode and decode', () => {
        let t0 = new Date().getTime();
        let buf = new BinBuffer();

        let ts = [t0 - 10000, t0 - 5000, t0];

        // Single zero bit for constant interval
        let encoded = compression.encodeTS(ts[2], ts[1], ts[0]);
        buf.writeBits(encoded[0], encoded[1]);
        buf.viewArray();
        expect(compression.decodeTS(buf, ts[1], ts[0])).toEqual(t0);
    });
});
