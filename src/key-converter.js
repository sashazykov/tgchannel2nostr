const HEX_KEY_REGEX = /^[0-9a-fA-F]{64}$/;
const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const BECH32_CHARSET_MAP = Object.create(null);
const BECH32_GENERATORS = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

for (let i = 0; i < BECH32_CHARSET.length; i += 1) {
	BECH32_CHARSET_MAP[BECH32_CHARSET[i]] = i;
}

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
		for (let i = 0; i < BECH32_GENERATORS.length; i += 1) {
			if ((top >> i) & 1) {
				chk ^= BECH32_GENERATORS[i];
			}
		}
	}
	return chk;
}

function verifyChecksum(hrp, data) {
	return polymod(hrpExpand(hrp).concat(data)) === 1;
}

function decodeBech32(value) {
	if (typeof value !== "string") {
		throw new Error("Nostr key must be a string");
	}
	const trimmed = value.trim();
	if (!trimmed) {
		throw new Error("Nostr key is empty");
	}
	if (trimmed !== trimmed.toLowerCase() && trimmed !== trimmed.toUpperCase()) {
		throw new Error("Bech32 keys cannot use mixed case");
	}
	const normalized = trimmed.toLowerCase();
	const separatorIndex = normalized.lastIndexOf("1");
	if (separatorIndex < 1 || separatorIndex + 7 > normalized.length) {
		throw new Error("Invalid bech32 key format");
	}

	const hrp = normalized.slice(0, separatorIndex);
	const data = [];
	for (const char of normalized.slice(separatorIndex + 1)) {
		const valueIndex = BECH32_CHARSET_MAP[char];
		if (valueIndex === undefined) {
			throw new Error("Invalid bech32 character");
		}
		data.push(valueIndex);
	}
	if (!verifyChecksum(hrp, data)) {
		throw new Error("Invalid bech32 checksum");
	}

	return {
		hrp,
		data: data.slice(0, -6),
	};
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

function bytesToHex(bytes) {
	return bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function normalizeNostrKey(key, expectedPrefix) {
	if (typeof key !== "string") {
		throw new Error("Nostr key must be a string");
	}
	const trimmed = key.trim();
	if (!trimmed) {
		throw new Error("Nostr key is empty");
	}
	if (HEX_KEY_REGEX.test(trimmed)) {
		return trimmed.toLowerCase();
	}

	const { hrp, data } = decodeBech32(trimmed);
	const expected = expectedPrefix.toLowerCase();
	if (hrp !== expected) {
		throw new Error(`Expected bech32 prefix ${expectedPrefix}`);
	}
	const bytes = convertBits(data, 5, 8, false);
	if (bytes.length !== 32) {
		throw new Error(`Invalid ${expectedPrefix} key length`);
	}
	return bytesToHex(bytes);
}
