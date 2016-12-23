/* eslint-env jasmine */
const TimeseriesCompression = require('./TimeseriesCompression');
const BinBuffer = require('binary-ring-buffer');

const byteToBitArray = (byte) => {
    let a = [];
    for (let i = 0; i < 8; i++) {
        a[8 - i - 1] = (byte & (1 << i)) > 0 ? 1 : 0;
    }
    return a;
};

const mapToHex = (v) => {
    if (v < 10) { return v; }
    if (v === 10) { return 'a'; }
    if (v === 11) { return 'b'; }
    if (v === 12) { return 'c'; }
    if (v === 13) { return 'd'; }
    if (v === 14) { return 'e'; }
    if (v === 15) { return 'f'; }
    return '';
};

const byteToHexArray = (byte) => {
    let a = [];
    a[0] = mapToHex(byte >> 4);
    a[1] = mapToHex(((byte << 4) & 255) >> 4);
    return a;
};

/* eslint-disable no-unused-vars */
const viewFloat = (v, type = 'hex') => {
    let a = new ArrayBuffer(8);
    let dataview = new DataView(a);
    dataview.setFloat64(0, v);

    let view = new Uint8Array(a);
    let values = [view[0], view[1], view[2], view[3], view[4], view[5], view[6], view[7]];
    let valuesHex = `0x${values.map(b => byteToHexArray(b).join('')).join('')}`;
    let valuesBin = `0x${values.map(b => byteToBitArray(b).join('')).join(',')}`;
    if (type === 'hex') {
        console.log(valuesHex);
    } else if (type === 'bin') {
        console.log(valuesBin);
    }
};

describe('float xor', () => {
    it('xor of the same number is zero', () => {
        let xor = TimeseriesCompression.floatXOR(Math.PI, Math.PI);
        expect(xor.xor).toEqual(0);
        expect(xor.leading).toEqual(64);
        expect(xor.trailing).toEqual(64);
        expect(xor.middle).toEqual(0);
    });

    it('xor of single bit diff', () => {
        let xor = TimeseriesCompression.floatXOR(100, 101);

        expect(xor.leading).toEqual(17);
        expect(xor.trailing).toEqual(46);
        expect(xor.middle).toEqual(1);
        expect(xor.meaningful).toEqual(1);
    });

    it('xor of three bit diff', () => {
        let xor = TimeseriesCompression.floatXOR(100, 106);

        expect(xor.leading).toEqual(14);
        expect(xor.trailing).toEqual(47);
        expect(xor.middle).toEqual(3);
        expect(xor.meaningful).toEqual(7);
    });

    it('xor of sign diff', () => {
        let xor = TimeseriesCompression.floatXOR(Math.PI, -Math.PI);

        expect(xor.leading).toEqual(0);
        expect(xor.trailing).toEqual(63);
        expect(xor.middle).toEqual(1);
        expect(xor.meaningful).toEqual(1);
    });

    it('xor of exp diff', () => {
        let xor = TimeseriesCompression.floatXOR(3 * Math.pow(2, 63), 3);

        // viewFloat(xor.xor, 'bin');
        // console.log(xor);
        expect(xor.leading).toEqual(6);
        expect(xor.trailing).toEqual(52);
        expect(xor.middle).toEqual(6);
        expect(xor.meaningful).toEqual(63);
    });
});

// let compression = new TimeseriesCompression();
describe('timeseries compression', () => {
    it('timestamp series of constant interval', () => {
        let t0 = new Date().getTime();

        // Single zero bit for constant interval
        let encoded = TimeseriesCompression.encodeTS(t0, t0 - 60, t0 - 120);
        expect(encoded).toEqual([0, 1]);
    });

    it('timestamp series can encode and decode', () => {
        let t0 = new Date().getTime();
        let buf = new BinBuffer();

        let ts = [t0 - 10000, t0 - 5000, t0];

        // Single zero bit for constant interval
        let encoded = TimeseriesCompression.encodeTS(ts[2], ts[1], ts[0]);
        buf.writeBits(encoded[0], encoded[1]);
        buf.viewArray();
        expect(TimeseriesCompression.decodeTS(buf, ts[1], ts[0])).toEqual(t0);
    });
});
