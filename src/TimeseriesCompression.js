const BinBuffer = require('binary-ring-buffer');

const POW_32 = Math.pow(2, 32);

// First and last nonzero bit lookup in nibble
// num bin F, L
//  0 0000 -, -
//  1 0001 3, 3
//  2 0010 2, 2
//  3 0011 2, 3
//  4 0100 1, 1
//  5 0101 1, 3
//  6 0110 1, 2
//  7 0111 1, 3
//  8 1000 0, 0
//  9 1001 0, 3
// 10 1010 0, 2
// 11 1011 0, 3
// 12 1100 0, 1
// 13 1101 0, 3
// 14 1110 0, 2
// 15 1111 0, 3
const FOUR_BIT_POS_FIRST = [0, 3, 2, 2, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0];
const FOUR_BIT_POS_LAST = [0, 3, 2, 3, 1, 3, 2, 3, 0, 3, 2, 3, 1, 3, 2, 3];

class TimeseriesCompression {
    static floatXOR(v1, v2) {
        let a = new ArrayBuffer(16);
        let dataview = new DataView(a);
        let buf = new BinBuffer();

        dataview.setFloat64(0, v1);
        dataview.setFloat64(8, v2);

        let leading = -1;
        let lastNonZero = -1;
        for (let i = 0; i < 8; i++) {
            let x = dataview.getUint8(i) ^ dataview.getUint8(8 + i);
            dataview.setUint8(i, x);
            buf.writeBits(x, 8);

            // Calc num leading zeros
            // if nonzero and leading is not set yet
            if (x && leading === -1) {
                if (x & 0xF0) {
                    // if first nibble nonzero shift and lookup
                    leading = i * 8 + FOUR_BIT_POS_FIRST[x >> 4];
                } else {
                    // else second nibble is nonzero and it's 4 plus the lookup
                    leading = i * 8 + 4 + FOUR_BIT_POS_FIRST[x];
                }
            }

            // if nonzero and leading has been set
            if (x && leading !== -1) {
                if (x & 0x0F) {
                    // if second nibble nonzero it's 4 + lookup on on second nibble
                    lastNonZero = i * 8 + 4 + FOUR_BIT_POS_LAST[x & 0x0F];
                } else {
                    // else first nibble nonzero so lookup on first
                    lastNonZero = i * 8 + FOUR_BIT_POS_LAST[x >> 4];
                }
            }
        }

        let trailing = 64 - (lastNonZero + 1);
        let middle = 64 - leading - trailing;
        let meaningful = 0;
        if (leading === -1) {
            leading = 64;
            middle = 0;
            trailing = 64;
        } else {
            buf.readBits(leading);
            meaningful = buf.readBits(middle);
        }

        return {
            leading,
            trailing,
            middle,
            meaningful,
            xor: dataview.getFloat64(0),
        };
    }

    static encodeValue(buf, value, prevValue, prevLeading, prevTrailing) {
        // first value has no compression
        if (prevValue === undefined) {
            buf.writeBits(value, 64);
            return {
                leading: 0,
                meaningful: 64,
            };
        }

        // if same value write a single 0 bit
        if (value === prevValue) {
            buf.writeBits(0, 1);
            return {
                leading: prevLeading,
                trailing: prevTrailing,
            };
        }

        // control bit 1
        buf.writeBits(1, 1);

        let xor = TimeseriesCompression.floatXOR(prevValue, value);

        // if within previous block, write only the meaningful bits
        let withinMeaningful = xor.leading >= prevLeading && xor.trailing >= prevTrailing;
        if (withinMeaningful) {
            // control bit 0
            buf.writeBits(0, 1);

            // write xor value
            buf.writeBits(xor.meaningful, 64 - prevLeading - prevTrailing);

            return {
                leading: prevLeading,
                trailing: prevTrailing,
            };
        }

        // control bit 1
        buf.writeBits(1, 1);

        // length of leading
        buf.writeBits(xor.leading, 5);

        // length of meaningful
        buf.writeBits(xor.middle, 6);

        // write xor value
        buf.writeBits(xor.meaningful, xor.middle);

        return {
            leading: xor.leading,
            trailing: xor.trailing,
        };
    }

    // static decodeValue(buf, prevValue) {
    //     // first value has no compression
    //     if (prevValue === undefined) {
    //         return buf.readBits(64);
    //     }
    // }

    static encodeTS(ts, prev1 = -1, prev2 = -1) {
        // TODO: will break in 2038 ;)
        if (prev1 < 0) { return [ts, 32]; }

        let dt = ts - prev1;
        let dd = dt;
        if (prev2 >= 0) {
            dd -= (prev1 - prev2);
        }

        if (dd === 0) {
            return [0, 1];
        }

        if (dd >= -63 && dd <= 64) {
            return [2 * (1 << 7) + dd + 63, 9];
        }

        if (dd >= -255 && dd <= 256) {
            return [6 * (1 << 9) + dd + 255, 12];
        }

        // Might want to add a bit for hourly data
        if (dd >= -2047 && dd <= 2048) {
            return [14 * (1 << 12) + dd + 2047, 16];
        }

        return [15 * POW_32 + dd + POW_32 / 2 - 1, 36];
    }

    static decodeTS(buf, prev1 = -1, prev2 = -1) {
        if (prev1 < 0) {
            return buf.readBits(32);
        }

        if (prev2 < 0) {
            return prev1 + buf.readBits(32);
        }

        let dt = prev1 - prev2;
        if (buf.readBits(1) === 0) {
            return prev1 + dt;
        }

        if (buf.readBits(1) === 0) {
            let dd = buf.readBits(7) - 63;
            return prev1 + dt + dd;
        }

        if (buf.readBits(1) === 0) {
            let dd = buf.readBits(9) - 255;
            return prev1 + dt + dd;
        }

        if (buf.readBits(1) === 0) {
            let dd = buf.readBits(12) - 2047;
            return prev1 + dt + dd;
        }

        let dd = buf.readBits(32) - (POW_32 / 2 - 1);
        return prev1 + dt + dd;
    }

    static encode(ts) {
        let encoded = [];
        ts.forEach((s) => {
            let e = [];
            if (!s.length) { return; }
            // let tL1 = s[0][0];
            // let vL1 = s[0][1];
            // let tL2 = tL1;
            e.push(s[0][0]); // header time
            e.push(0); // first point delta time
            e.push(s[0][1]);
            s.forEach((p, i) => {
                if (i === 0) { return; }
                let t = p[0];
                let dt = t - s[i - 1][0];
                let deltaDelta = 0;
                if (i >= 2) {
                    deltaDelta = dt - (s[i - 1][0] - s[i - 2][0]);
                } else {
                    deltaDelta = dt;
                }
                if (deltaDelta === 0) {
                    e.push(0);
                } else {
                    e.push(`${dt}:${deltaDelta}`);
                }

                let v = p[1];
                e.push(v);
            });
            encoded.push(e);
        });

        // console.log(encoded);
        return ts;
    }

    static decode(ts) {
        // implement me!
        return ts;
    }
}

module.exports = TimeseriesCompression;
