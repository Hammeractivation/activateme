/** Known shared / fake SMBIOS UUIDs from custom Windows images. */

const KNOWN_ABNORMAL_STEMS = new Set([
  "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF",
  "00000000000000000000000000000000",
  "03000200040005000006000700080009",
  "2462F1A8EE0AB744A8875D6A8E5D2609",
]);

/** Marker inside `.user` file content for seller-approved custom OS devices. */
export const MANUAL_APPROVAL_MARKER = "Manual-Approved: quickplay-win";

export function normalizeHwidStem(value: string): string | null {
  const cleaned = value.replace(/-/g, "").trim().toUpperCase();
  if (!/^[0-9A-F]{32}$/.test(cleaned)) return null;
  return cleaned;
}

export function isAbnormalHwidStem(stem: string): boolean {
  const normalized = normalizeHwidStem(stem);
  if (!normalized) return true;
  if (KNOWN_ABNORMAL_STEMS.has(normalized)) return true;
  // All 32 hex digits identical (FFFFFFFF…, 00000000…, etc.)
  if (/^(.)\1{31}$/.test(normalized)) return true;
  return false;
}

export function isManualApprovedContent(content: string): boolean {
  return content.includes(MANUAL_APPROVAL_MARKER);
}

const DEVICE_FP_LINE = /^Device-FP:\s*([0-9a-fA-F]{64})\s*$/m;

export function normalizeDeviceFp(value: string): string | null {
  const cleaned = value.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(cleaned)) return null;
  return cleaned;
}
