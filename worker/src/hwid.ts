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

const MSEED = 2147483647;

class NetRandom {
  private _seedArray: number[];
  private _inext: number;
  private _inextp: number;

  constructor(seed: number) {
    const seedArray = new Array<number>(56).fill(0);
    let mj = MSEED - Math.abs(seed);
    seedArray[55] = mj;
    let mk = 1;
    for (let i = 1; i < 55; i++) {
      const ii = (21 * i) % 55;
      seedArray[ii] = mk;
      mk = mj - mk;
      if (mk < 0) mk += MSEED;
      mj = seedArray[ii];
    }
    for (let k = 1; k < 5; k++) {
      for (let i = 1; i < 55; i++) {
        seedArray[i] -= seedArray[1 + ((i + 30) % 55)];
        if (seedArray[i] < 0) seedArray[i] += MSEED;
      }
    }
    this._seedArray = seedArray;
    this._inext = 0;
    this._inextp = 21;
  }

  next(maxValue: number): number {
    let locINext = this._inext + 1;
    let locINextp = this._inextp + 1;
    if (locINext >= 56) locINext = 1;
    if (locINextp >= 56) locINextp = 1;
    let retVal = this._seedArray[locINext] - this._seedArray[locINextp];
    if (retVal === MSEED) retVal--;
    if (retVal < 0) retVal += MSEED;
    this._seedArray[locINext] = retVal;
    this._inext = locINext;
    this._inextp = locINextp;
    return Math.floor((retVal * maxValue) / MSEED);
  }
}

function hashKeyHex(): number {
  let h = 17;
  for (let i = 0; i < KEY_HEX.length; i++) {
    h = Math.imul(h, 31) + KEY_HEX.charCodeAt(i);
    h |= 0;
  }
  return h;
}

function buildPerm(n: number): number[] {
  const arr = Array.from({ length: n }, (_, i) => i);
  const rand = new NetRandom(hashKeyHex() + n);
  for (let i = n - 1; i > 0; i--) {
    const j = rand.next(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Onetap SteamOS — variable-length dynamic code (DecodeDynamic in desktop app). */
export function decodeDynamic(code: string): string {
  const cleaned = sanitize(code);
  if (!cleaned || cleaned.length < 10) {
    throw new Error("Invalid code length.");
  }

  const payload = cleaned.slice(5, cleaned.length - 5);
  const perm = buildPerm(payload.length);
  const descrambled = new Array<string>(payload.length);
  for (let i = 0; i < payload.length; i++) descrambled[perm[i]] = payload[i];

  const xored = hexToBytes(descrambled.join(""));
  const key = hexToBytes(KEY_HEX);
  const orig = new Uint8Array(xored.length);
  for (let i = 0; i < xored.length; i++) {
    orig[i] = xored[i] ^ key[i % key.length];
  }
  return new TextDecoder().decode(orig);
}

export function hwidToFileStem(hwid: string): string {
  return hwid.replace(/-/g, "");
}
