import type { Env, RateLimitResult } from "./types";

const CHALLENGE_TTL_SEC = 300;

function signingSecret(env: Env): string {
  const token = env.KEYGEN_ADMIN_TOKEN?.trim();
  if (token) return token;
  throw new Error("Challenge signing secret unavailable");
}

async function hmacSign(secret: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return base64Url(new Uint8Array(sig));
}

function base64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Stateless signed token — no KV write per challenge (avoids daily KV put quota). */
export async function issueChallenge(
  env: Env,
  ip: string
): Promise<{ challengeId: string } | RateLimitResult> {
  const rate = await consumeChallengeRate(env.RATE_LIMIT, ip);
  if (!rate.allowed) return rate;

  const now = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomUUID();
  const payload = `${now}.${nonce}`;
  const sig = await hmacSign(signingSecret(env), payload);
  return { challengeId: `${payload}.${sig}` };
}

export async function consumeChallenge(
  env: Env,
  challengeId: string,
  _ip: string
): Promise<boolean> {
  const parts = challengeId.trim().split(".");
  if (parts.length !== 3) return false;

  const [tsStr, nonce, sig] = parts;
  if (!tsStr || !nonce || !sig) return false;

  const ts = Number.parseInt(tsStr, 10);
  if (!Number.isFinite(ts)) return false;

  const now = Math.floor(Date.now() / 1000);
  if (ts > now + 60 || now - ts > CHALLENGE_TTL_SEC) return false;

  const payload = `${tsStr}.${nonce}`;
  try {
    const expected = await hmacSign(signingSecret(env), payload);
    return sig === expected;
  } catch {
    return false;
  }
}

async function consumeChallengeRate(
  kv: KVNamespace,
  ip: string
): Promise<RateLimitResult> {
  try {
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
    // KV quota or outage — allow challenge issuance
    return { allowed: true };
  }
}
