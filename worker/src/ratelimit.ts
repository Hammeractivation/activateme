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
  checkKeyIp: { max: 5, windowSec: 300, stackSec: 300 } satisfies RateLimitRule,
  activateIp: { max: 3, windowSec: 3600 } satisfies RateLimitRule,
  checkKeyValue: { max: 3, windowSec: 600 } satisfies RateLimitRule,
  activateKey: { max: 2, windowSec: 3600 } satisfies RateLimitRule,
  failIp: { max: 10, windowSec: 1800 } satisfies RateLimitRule,
};

async function readCounter(
  kv: KVNamespace,
  key: string
): Promise<StoredCounter | null> {
  const raw = await kv.get(key);
  if (!raw) return null;
  try {
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
  await kv.put(key, JSON.stringify(value), { expirationTtl: ttlSec });
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

  return { allowed: true };
}

export async function recordFailedAttempt(
  kv: KVNamespace,
  ip: string
): Promise<RateLimitResult> {
  return consume(kv, `rl:fail:ip:${ip}`, RULES.failIp);
}

export async function isIpBanned(kv: KVNamespace, ip: string): Promise<boolean> {
  const counter = await readCounter(kv, `rl:fail:ip:${ip}`);
  if (!counter) return false;
  const now = Math.floor(Date.now() / 1000);
  return counter.count >= RULES.failIp.max && counter.resetAt > now;
}
