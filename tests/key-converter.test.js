import { describe, it, expect } from 'vitest';
import { normalizeNostrKey } from '../src/key-converter.js';

const PUBLIC_KEY_HEX = 'a'.repeat(64);
const PRIVATE_KEY_HEX = 'b'.repeat(64);
const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const GENERATORS = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function hrpExpand(hrp) {
	const ret = [];
	for (let i = 0; i < hrp.length; i += 1) {
		ret.push(hrp.charCodeAt(i) >> 5);
	}
	ret.push(0);
	for (let i = 0; i < hrp.length; i += 1) {
		ret.push(hrp.charCodeAt(i) & 31);
	}
	return ret;
}

function polymod(values) {
	let chk = 1;
	for (const value of values) {
		const top = chk >> 25;
		chk = ((chk & 0x1ffffff) << 5) ^ value;
		for (let i = 0; i < GENERATORS.length; i += 1) {
			if ((top >> i) & 1) {
				chk ^= GENERATORS[i];
			}
		}
	}
	return chk;
}

function createChecksum(hrp, data) {
	const values = hrpExpand(hrp).concat(data).concat([0, 0, 0, 0, 0, 0]);
	const mod = polymod(values) ^ 1;
	const ret = [];
	for (let p = 0; p < 6; p += 1) {
		ret.push((mod >> (5 * (5 - p))) & 31);
	}
	return ret;
}

function convertBits(data, fromBits, toBits, pad) {
	let acc = 0;
	let bits = 0;
	const ret = [];
	const maxv = (1 << toBits) - 1;
	const maxAcc = (1 << (fromBits + toBits - 1)) - 1;

	for (const value of data) {
		if (value < 0 || value >> fromBits) {
			throw new Error("Invalid bech32 value");
		}
		acc = ((acc << fromBits) | value) & maxAcc;
		bits += fromBits;
		while (bits >= toBits) {
			bits -= toBits;
			ret.push((acc >> bits) & maxv);
		}
	}

	if (pad) {
		if (bits > 0) {
			ret.push((acc << (toBits - bits)) & maxv);
		}
	} else {
		if (bits >= fromBits) {
			throw new Error("Invalid bech32 padding");
		}
		if ((acc << (toBits - bits)) & maxv) {
			throw new Error("Invalid bech32 padding");
		}
	}

	return ret;
}

function hexToBytes(hex) {
	const bytes = [];
	for (let i = 0; i < hex.length; i += 2) {
		bytes.push(Number.parseInt(hex.slice(i, i + 2), 16));
	}
	return bytes;
}

function encodeBech32(hrp, data) {
	return `${hrp}1${data.map((value) => CHARSET[value]).join("")}`;
}

function encodeNostrKey(prefix, hex) {
	const words = convertBits(hexToBytes(hex), 8, 5, true);
	const checksum = createChecksum(prefix, words);
	return encodeBech32(prefix, words.concat(checksum));
}

describe('normalizeNostrKey', () => {
	it('returns hex keys in lowercase', () => {
		expect(normalizeNostrKey(PUBLIC_KEY_HEX.toUpperCase(), 'npub')).toBe(PUBLIC_KEY_HEX);
	});

	it('decodes npub/nsec bech32 keys', () => {
		const npub = encodeNostrKey('npub', PUBLIC_KEY_HEX);
		const nsec = encodeNostrKey('nsec', PRIVATE_KEY_HEX);
		expect(normalizeNostrKey(npub, 'npub')).toBe(PUBLIC_KEY_HEX);
		expect(normalizeNostrKey(nsec, 'nsec')).toBe(PRIVATE_KEY_HEX);
	});
});
