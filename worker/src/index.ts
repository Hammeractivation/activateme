import { getProduct, resolveRepo } from "./products";
import {
  createHwidFile,
  deleteKeyFile,
  formatPhilippineTimeNow,
  getKeyUsedDatePH,
  keyFileExists,
  notifyDiscord,
} from "./github";
import { decodeCode42ToUuid, uuidToFileStem } from "./hwid";
import {
  checkRateLimits,
  isIpBanned,
  recordFailedAttempt,
} from "./ratelimit";
import type { ApiResponse, Env } from "./types";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data: ApiResponse, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function getClientIp(request: Request): string {
  return (
    request.headers.get("CF-Connecting-IP") ??
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

function sanitizeKey(key: string): string {
  return key.trim().replace(/[^a-zA-Z0-9._-]/g, "");
}

function missingSecrets(env: Env): string[] {
  const required = [
    "HAMMER_KEYS_PAT",
    "HAMMER_HWID_PAT",
    "VALVEOFF_KEYS_PAT",
    "VALVEOFF_HWID_PAT",
  ] as const;
  return required.filter((name) => !env[name]);
}

async function handleCheckKey(
  env: Env,
  ip: string,
  productId: string,
  key: string
): Promise<Response> {
  const product = getProduct(productId);
  if (!product) return json({ status: "error", message: "Invalid product." }, 400);

  if (!key) return json({ status: "error", message: "Key is required." }, 400);

  const rate = await checkRateLimits(env.RATE_LIMIT, "check-key", ip, key);
  if (!rate.allowed) {
    return json(
      {
        status: "rate_limited",
        message: "Too many requests. Please wait before checking again.",
        retryAfter: rate.retryAfter,
      },
      429
    );
  }

  const keys = resolveRepo(env, product, "keys");
  const hwid = resolveRepo(env, product, "hwid");
  const exists = await keyFileExists(keys.owner, keys.repo, keys.pat, key);

  if (exists) {
    return json({
      status: "valid",
      message: "Key is valid and not yet used.",
    });
  }

  const usedDate = await getKeyUsedDatePH(
    hwid.owner,
    hwid.repo,
    hwid.pat,
    key,
    product.hwidLookupExtensions
  );

  if (usedDate) {
    return json({
      status: "used",
      message: "Key was already registered.",
      datePH: usedDate,
    });
  }

  await recordFailedAttempt(env.RATE_LIMIT, ip);
  return json({
    status: "not_found",
    message: "Key not found in database.",
  });
}

async function handleActivate(
  env: Env,
  ip: string,
  productId: string,
  key: string,
  code42: string
): Promise<Response> {
  const product = getProduct(productId);
  if (!product) return json({ status: "error", message: "Invalid product." }, 400);

  if (!key || !code42) {
    return json(
      { status: "error", message: "Key and registration code are required." },
      400
    );
  }

  const rate = await checkRateLimits(env.RATE_LIMIT, "activate", ip, key);
  if (!rate.allowed) {
    return json(
      {
        status: "rate_limited",
        message: "Too many activation attempts. Please wait.",
        retryAfter: rate.retryAfter,
      },
      429
    );
  }

  const keys = resolveRepo(env, product, "keys");
  const hwidRepo = resolveRepo(env, product, "hwid");

  const exists = await keyFileExists(keys.owner, keys.repo, keys.pat, key);
  if (!exists) {
    await recordFailedAttempt(env.RATE_LIMIT, ip);
    return json({
      status: "not_found",
      message: "Key not found. Contact your seller.",
    });
  }

  let uuid36: string;
  try {
    uuid36 = decodeCode42ToUuid(code42, true);
  } catch (err) {
    await recordFailedAttempt(env.RATE_LIMIT, ip);
    const msg = err instanceof Error ? err.message : "Invalid registration code.";
    return json({ status: "error", message: `Invalid registration code. ${msg}` }, 400);
  }

  const deleted = await deleteKeyFile(keys.owner, keys.repo, keys.pat, key);
  if (!deleted) {
    return json(
      {
        status: "error",
        message: "Key was found but could not be consumed. Try again or contact support.",
      },
      500
    );
  }

  const uuidStem = uuidToFileStem(uuid36);
  const fileName = `${uuidStem}${product.hwidExtension}`;
  const created = await createHwidFile(
    hwidRepo.owner,
    hwidRepo.repo,
    hwidRepo.pat,
    fileName,
    uuidStem,
    key
  );

  if (!created) {
    return json(
      {
        status: "error",
        message:
          "Failed to register device. You might already be registered.",
      },
      409
    );
  }

  if (env.DISCORD_WEBHOOK_URL) {
    const timePH = formatPhilippineTimeNow();
    const commitMessage = `Create ${fileName} with key: ${key}`;
    try {
      await notifyDiscord(
        env.DISCORD_WEBHOOK_URL,
        uuid36,
        key,
        timePH,
        commitMessage
      );
    } catch {
      // Do not block activation if Discord fails
    }
  }

  return json({
    status: "success",
    message:
      "Successfully registered device. Please wait 2-4 minutes, then open your app again.",
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method === "GET" && url.pathname === "/api/v1/health") {
      const missing = missingSecrets(env);
      return json({
        status: missing.length ? "misconfigured" : "ok",
        message: missing.length
          ? `Missing secrets: ${missing.join(", ")}`
          : "ActivateMe API is running.",
      });
    }

    if (request.method !== "POST") {
      return json({ status: "error", message: "Method not allowed." }, 405);
    }

    const ip = getClientIp(request);
    if (await isIpBanned(env.RATE_LIMIT, ip)) {
      return json(
        {
          status: "rate_limited",
          message: "Too many failed attempts. Try again later.",
          retryAfter: 1800,
        },
        429
      );
    }

    let body: Record<string, string>;
    try {
      body = (await request.json()) as Record<string, string>;
    } catch {
      return json({ status: "error", message: "Invalid JSON body." }, 400);
    }

    const product = body.product?.trim();
    const key = sanitizeKey(body.key ?? "");
    const code42 = body.code42?.trim() ?? "";

    if (url.pathname === "/api/v1/check-key") {
      return handleCheckKey(env, ip, product, key);
    }

    if (url.pathname === "/api/v1/activate") {
      return handleActivate(env, ip, product, key, code42);
    }

    return json({ status: "error", message: "Not found." }, 404);
  },
};
