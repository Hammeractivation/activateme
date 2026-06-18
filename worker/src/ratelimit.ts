import type { RateLimitResult } from "./types";

interface RateLimitRule {
  max: number;
  windowSec: number;
  stackSec?: number;
}

interface StoredCounter {
  count: number;
  resetAt: number;
  penaltySec: number;
}

const RULES = {
  // Check key: generous for resellers testing multiple keys
  checkKeyIp: { max: 20, windowSec: 300, stackSec: 120 } satisfies RateLimitRule,
  checkKeyValue: { max: 10, windowSec: 600 } satisfies RateLimitRule,
  // Activate: allow ~15 devices/hour per IP (reseller batch)
  activateIp: { max: 15, windowSec: 3600 } satisfies RateLimitRule,
  // Per key: 3 tries/hour (wrong code retries, not spam)
  activateKey: { max: 3, windowSec: 3600 } satisfies RateLimitRule,
  failIp: { max: 25, windowSec: 1800 } satisfies RateLimitRule,
  adminOpIp: { max: 600, windowSec: 3600 } satisfies RateLimitRule,
  adminFailIp: { max: 10, windowSec: 300, stackSec: 120 } satisfies RateLimitRule,
};

async function readCounter(
  kv: KVNamespace,
  key: string
): Promise<StoredCounter | null> {
  try {
    const raw = await kv.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as StoredCounter;
  } catch {
    return null;
  }
}

async function writeCounter(
  kv: KVNamespace,
  key: string,
  value: StoredCounter,
  ttlSec: number
): Promise<void> {
  try {
    await kv.put(key, JSON.stringify(value), { expirationTtl: ttlSec });
  } catch {
    // KV quota/outage — skip write
  }
}

async function consume(
  kv: KVNamespace,
  key: string,
  rule: RateLimitRule,
  stackOnHit = false
): Promise<RateLimitResult> {
  const now = Math.floor(Date.now() / 1000);
  const existing = await readCounter(kv, key);
  let counter: StoredCounter;

  if (!existing || existing.resetAt <= now) {
    counter = { count: 1, resetAt: now + rule.windowSec, penaltySec: 0 };
    await writeCounter(kv, key, counter, rule.windowSec + 60);
    return { allowed: true };
  }

  const effectiveWindow = rule.windowSec + existing.penaltySec;
  const retryAfter = existing.resetAt - now;

  if (existing.count >= rule.max) {
    if (stackOnHit && rule.stackSec) {
      counter = {
        count: existing.count + 1,
        resetAt: existing.resetAt + rule.stackSec,
        penaltySec: existing.penaltySec + rule.stackSec,
      };
      await writeCounter(kv, key, counter, counter.resetAt - now + 60);
    }
    return { allowed: false, retryAfter: Math.max(retryAfter, 60) };
  }

  counter = {
    count: existing.count + 1,
    resetAt: existing.resetAt,
    penaltySec: existing.penaltySec,
  };
  await writeCounter(kv, key, counter, effectiveWindow + 60);
  return { allowed: true };
}

export async function checkRateLimits(
  kv: KVNamespace,
  action: "check-key" | "activate",
  ip: string,
  key?: string
): Promise<RateLimitResult> {
  try {
    const ipRule =
      action === "check-key" ? RULES.checkKeyIp : RULES.activateIp;
    const ipResult = await consume(
      kv,
      `rl:${action}:ip:${ip}`,
      ipRule,
      action === "check-key"
    );
    if (!ipResult.allowed) return ipResult;

    if (key) {
      const keyRule =
        action === "check-key" ? RULES.checkKeyValue : RULES.activateKey;
      const keyResult = await consume(kv, `rl:${action}:key:${key}`, keyRule);
      if (!keyResult.allowed) return keyResult;
    }
  } catch {
    return { allowed: true };
  }

  return { allowed: true };
}

export async function recordFailedAttempt(
  kv: KVNamespace,
  ip: string
): Promise<RateLimitResult> {
  try {
    return await consume(kv, `rl:fail:ip:${ip}`, RULES.failIp);
  } catch {
    return { allowed: true };
  }
}

export async function isIpBanned(kv: KVNamespace, ip: string): Promise<boolean> {
  try {
    const counter = await readCounter(kv, `rl:fail:ip:${ip}`);
    if (!counter) return false;
    const now = Math.floor(Date.now() / 1000);
    return counter.count >= RULES.failIp.max && counter.resetAt > now;
  } catch {
    return false;
  }
}

export async function checkAdminRateLimits(
  kv: KVNamespace,
  ip: string
): Promise<RateLimitResult> {
  return consume(kv, `rl:admin:ip:${ip}`, RULES.adminOpIp);
}

export async function recordAdminFailedAttempt(
  kv: KVNamespace,
  ip: string
): Promise<void> {
  await consume(kv, `rl:admin-fail:ip:${ip}`, RULES.adminFailIp, true);
}

export async function isAdminIpBanned(kv: KVNamespace, ip: string): Promise<boolean> {
  const counter = await readCounter(kv, `rl:admin-fail:ip:${ip}`);
  if (!counter) return false;
  const now = Math.floor(Date.now() / 1000);
  return counter.count >= RULES.adminFailIp.max && counter.resetAt > now;
}
