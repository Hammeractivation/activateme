const KEY_HEX = "A1B2C3D4E5F60718293A4B5C6D7E8F90";

const PERM32 = [
  13, 27, 2, 19, 31, 7, 22, 0, 17, 5, 29, 10, 23, 14, 8, 3, 28, 21, 11, 24, 16,
  30, 6, 26, 1, 18, 12, 25, 9, 20, 15, 4,
];

function sanitize(s: string): string {
  return s.replace(/[\s\t\r\n]/g, "");
}

function fromHexNibble(c: string): number {
  const code = c.charCodeAt(0);
  if (code >= 48 && code <= 57) return code - 48;
  if (code >= 65 && code <= 70) return code - 55;
  if (code >= 97 && code <= 102) return code - 87;
  throw new Error(`Invalid hex character '${c}'.`);
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error("Hex length must be even.");
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = (fromHexNibble(hex[2 * i]) << 4) | fromHexNibble(hex[2 * i + 1]);
  }
  return bytes;
}

function bytesToHexUpper(data: Uint8Array): string {
  const chars = "0123456789ABCDEF";
  let out = "";
  for (const b of data) {
    out += chars[(b >> 4) & 0xf] + chars[b & 0xf];
  }
  return out;
}

function unpermuteExact(s: string, perm: number[]): string {
  const output = new Array<string>(perm.length);
  for (let i = 0; i < perm.length; i++) output[perm[i]] = s[i];
  return output.join("");
}

function insertDashes(hex32: string): string {
  return `${hex32.slice(0, 8)}-${hex32.slice(8, 12)}-${hex32.slice(12, 16)}-${hex32.slice(16, 20)}-${hex32.slice(20)}`;
}

export function decodeCode42ToUuid(code42: string, dashed = true): string {
  const cleaned = sanitize(code42);
  if (cleaned.length !== 42) {
    throw new Error(`Code must be exactly 42 characters, got ${cleaned.length}.`);
  }

  const obfHex32 = cleaned.slice(5, 37);
  const xoredHex = unpermuteExact(obfHex32, PERM32);
  const xoredBytes = hexToBytes(xoredHex);
  const keyBytes = hexToBytes(KEY_HEX);
  const hwidBytes = new Uint8Array(16);

  for (let i = 0; i < 16; i++) hwidBytes[i] = xoredBytes[i] ^ keyBytes[i];

  const hex32 = bytesToHexUpper(hwidBytes);
  return dashed ? insertDashes(hex32) : hex32;
}

export function uuidToFileStem(uuid36: string): string {
  return uuid36.replace(/-/g, "");
}
