import type { RateLimitResult } from "./types";

const CHALLENGE_TTL_SEC = 300;

export async function issueChallenge(
  kv: KVNamespace,
  ip: string
): Promise<{ challengeId: string } | RateLimitResult> {
  const rate = await consumeChallengeRate(kv, ip);
  if (!rate.allowed) return rate;

  const challengeId = crypto.randomUUID();
  await kv.put(`ch:${challengeId}`, ip, { expirationTtl: CHALLENGE_TTL_SEC });
  return { challengeId };
}

export async function consumeChallenge(
  kv: KVNamespace,
  challengeId: string,
  ip: string
): Promise<boolean> {
  const key = `ch:${challengeId.trim()}`;
  if (!key || key === "ch:") return false;

  const stored = await kv.get(key);
  if (!stored) return false;

  await kv.delete(key);
  return stored === ip || stored === "unknown";
}

async function consumeChallengeRate(
  kv: KVNamespace,
  ip: string
): Promise<RateLimitResult> {
  const now = Math.floor(Date.now() / 1000);
  const bucketKey = `rl:challenge:ip:${ip}`;
  const raw = await kv.get(bucketKey);
  const windowSec = 300;
  const max = 30;

  if (!raw) {
    await kv.put(
      bucketKey,
      JSON.stringify({ count: 1, resetAt: now + windowSec }),
      { expirationTtl: windowSec + 60 }
    );
    return { allowed: true };
  }

  try {
    const counter = JSON.parse(raw) as { count: number; resetAt: number };
    if (counter.resetAt <= now) {
      await kv.put(
        bucketKey,
        JSON.stringify({ count: 1, resetAt: now + windowSec }),
        { expirationTtl: windowSec + 60 }
      );
      return { allowed: true };
    }
    if (counter.count >= max) {
      return { allowed: false, retryAfter: Math.max(counter.resetAt - now, 60) };
    }
    counter.count += 1;
    await kv.put(bucketKey, JSON.stringify(counter), {
      expirationTtl: counter.resetAt - now + 60,
    });
    return { allowed: true };
  } catch {
    return { allowed: true };
  }
}
