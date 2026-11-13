import { getRandomValues } from "node:crypto";

// A prefixed TypeID (https://github.com/jetify-com/typeid): `<prefix>_<suffix>`, where the
// suffix is a UUID in 26 characters of Crockford base32, lowercase. New ids carry a UUIDv7.
export type Id<P extends string> = `${P}_${string}`;

const alphabet = "0123456789abcdefghjkmnpqrstvwxyz";
const prefixPattern = /^[a-z]([a-z_]{0,61}[a-z])?$/;
// 26 characters hold 130 bits, so the first may only use the low 3 bits (0-7) to stay within 128.
const suffixPattern = "[0-7][0-9a-hjkmnp-tv-z]{25}";
const idPattern = new RegExp(`^(.+)_(${suffixPattern})$`);
const uuidPattern =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const prefixAssert = (prefix: string): void => {
	if (!prefixPattern.test(prefix)) {
		throw new TypeError(
			`Invalid id prefix "${prefix}": use snake_case, matching ${prefixPattern}`,
		);
	}
};

const suffixFromHex = (hex: string): string => {
	let value = BigInt(`0x${hex}`);
	let suffix = "";
	for (let index = 0; index < 26; index++) {
		suffix = alphabet.charAt(Number(value & 31n)) + suffix;
		value >>= 5n;
	}
	return suffix;
};

const hexFromSuffix = (suffix: string): string => {
	let value = 0n;
	for (const char of suffix) {
		value = (value << 5n) | BigInt(alphabet.indexOf(char));
	}
	return value.toString(16).padStart(32, "0");
};

// RFC 9562 UUIDv7: 48 bits of Unix time in milliseconds, version 7, 74 random bits, variant 10.
const uuidV7Hex = (): string => {
	const bytes = getRandomValues(new Uint8Array(16));
	let time = Date.now();
	for (let index = 5; index >= 0; index--) {
		bytes[index] = time % 256;
		time = Math.floor(time / 256);
	}
	bytes[6] = 0x70 | ((bytes[6] ?? 0) & 0x0f);
	bytes[8] = 0x80 | ((bytes[8] ?? 0) & 0x3f);
	return Buffer.from(bytes).toString("hex");
};

export const idCreate = <P extends string>(prefix: P): Id<P> => {
	prefixAssert(prefix);
	return `${prefix}_${suffixFromHex(uuidV7Hex())}`;
};

// Matches only ids with exactly this prefix, so a `bar` id never passes as a `foo` id. Give it to
// your validator's string pattern check to build an id schema.
export const idPatternCreate = (prefix: string): RegExp => {
	prefixAssert(prefix);
	return new RegExp(`^${prefix}_${suffixPattern}$`);
};

// The bare UUID for the postgres `uuid` column.
export const idToUuid = (id: Id<string>): string => {
	const match = idPattern.exec(id);
	if (!match?.[1] || !match[2] || !prefixPattern.test(match[1])) {
		throw new TypeError("Invalid id");
	}
	const hex = hexFromSuffix(match[2]);
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

export const idFromUuid = <P extends string>(
	prefix: P,
	uuid: string,
): Id<P> => {
	prefixAssert(prefix);
	if (!uuidPattern.test(uuid)) {
		throw new TypeError("Invalid UUID");
	}
	return `${prefix}_${suffixFromHex(uuid.replaceAll("-", ""))}`;
};
