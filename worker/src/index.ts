import { getProduct, resolveRepo } from "./products";
import {
  createKeyFile,
  createHwidFile,
  deleteKeyFile,
  formatPhilippineTimeNow,
  getKeyUsedDatePH,
  keyFileExists,
  listKeyFiles,
  notifyDiscord,
} from "./github";
import { decodeCode42ToUuid, decodeDynamic, hwidToFileStem, uuidToFileStem } from "./hwid";
import {
  checkRateLimits,
  isIpBanned,
  recordFailedAttempt,
} from "./ratelimit";
import type { ApiResponse, Env, ProductConfig } from "./types";

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

function isAdminAuthorized(request: Request, env: Env): boolean {
  const token = env.KEYGEN_ADMIN_TOKEN?.trim();
  if (!token) return false;
  const incoming = request.headers.get("X-Admin-Token")?.trim();
  return !!incoming && incoming === token;
}

function missingSecrets(env: Env): string[] {
  const required = [
    "HAMMER_KEYS_PAT",
    "HAMMER_HWID_PAT",
    "VALVEOFF_KEYS_PAT",
    "VALVEOFF_HWID_PAT",
    "ONETAP_KEYS_PAT",
    "ONETAP_HWID_PAT",
    "GAMENATIVE_KEYS_PAT",
    "GAMENATIVE_HWID_PAT",
  ] as const;
  return required.filter((name) => !env[name]);
}

function decodeRegistrationCode(
  product: ProductConfig,
  rawCode: string
): { hwid: string; fileStem: string } {
  const cleaned = rawCode.replace(/[\s\t\r\n]/g, "");

  if (product.codeMode === "code42") {
    if (cleaned.length !== 42) {
      throw new Error(
        `Registration code must be exactly 42 characters (got ${cleaned.length}).`
      );
    }
    const uuid36 = decodeCode42ToUuid(rawCode, true);
    return { hwid: uuid36, fileStem: uuidToFileStem(uuid36) };
  }

  if (cleaned.length < 10) {
    throw new Error("Registration code is too short.");
  }
  const hwid = decodeDynamic(rawCode);
  return { hwid, fileStem: hwidToFileStem(hwid) };
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

  let hwid: string;
  let fileStem: string;
  try {
    ({ hwid, fileStem } = decodeRegistrationCode(product, code42));
  } catch (err) {
    await recordFailedAttempt(env.RATE_LIMIT, ip);
    const msg = err instanceof Error ? err.message : "Invalid registration code.";
    return json(
      {
        status: "error",
        message: `Invalid registration code. ${msg} Your key was not used.`,
      },
      400
    );
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

  const fileName = `${fileStem}${product.hwidExtension}`;
  const created = await createHwidFile(
    hwidRepo.owner,
    hwidRepo.repo,
    hwidRepo.pat,
    fileName,
    fileStem,
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
        hwid,
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

async function handleAdminCreateKey(
  env: Env,
  productId: string,
  key: string
): Promise<Response> {
  const product = getProduct(productId);
  if (!product) return json({ status: "error", message: "Invalid product." }, 400);
  if (!key) return json({ status: "error", message: "Key is required." }, 400);

  const keys = resolveRepo(env, product, "keys");
  const exists = await keyFileExists(keys.owner, keys.repo, keys.pat, key);
  if (exists) {
    return json({ status: "exists", message: "Key already exists." }, 409);
  }
  const created = await createKeyFile(keys.owner, keys.repo, keys.pat, key);
  if (!created) {
    return json({ status: "error", message: "Failed to create key." }, 500);
  }
  return json({ status: "success", message: "Key created successfully." });
}

async function handleAdminListKeys(
  env: Env,
  productId: string,
  search: string
): Promise<Response> {
  const product = getProduct(productId);
  if (!product) return json({ status: "error", message: "Invalid product." }, 400);
  const keys = resolveRepo(env, product, "keys");
  const all = await listKeyFiles(keys.owner, keys.repo, keys.pat);
  const q = search.trim().toUpperCase();
  const filtered = q ? all.filter((k) => k.toUpperCase().includes(q)) : all;
  return json({ status: "success", keys: filtered.slice(0, 500) } as ApiResponse & { keys: string[] });
}

async function handleAdminDeleteKey(
  env: Env,
  productId: string,
  key: string
): Promise<Response> {
  const product = getProduct(productId);
  if (!product) return json({ status: "error", message: "Invalid product." }, 400);
  if (!key) return json({ status: "error", message: "Key is required." }, 400);
  const keys = resolveRepo(env, product, "keys");
  const deleted = await deleteKeyFile(keys.owner, keys.repo, keys.pat, key);
  if (!deleted) {
    return json({ status: "error", message: "Failed to delete key." }, 500);
  }
  return json({ status: "success", message: "Key deleted successfully." });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handleRequest(request, env);
    } catch (err) {
      console.error("Worker error:", err);
      return json(
        {
          status: "error",
          message: "Internal server error. Please try again later.",
        },
        500
      );
    }
  },
};

async function handleRequest(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method === "GET" && url.pathname === "/api/v1/health") {
      const missing = missingSecrets(env);
      if (missing.length) {
        return json({
          status: "down",
          ready: false,
          message: "Activation service is temporarily unavailable.",
        });
      }
      return json({
        status: "up",
        ready: true,
        message: "Ready to activate.",
      });
    }

    if (request.method !== "POST") {
      return json({ status: "error", message: "Method not allowed." }, 405);
    }

    if (
      url.pathname === "/api/v1/admin/create-key" ||
      url.pathname === "/api/v1/admin/list-keys" ||
      url.pathname === "/api/v1/admin/delete-key"
    ) {
      if (!isAdminAuthorized(request, env)) {
        return json({ status: "error", message: "Unauthorized." }, 401);
      }

      let adminBody: Record<string, string>;
      try {
        adminBody = (await request.json()) as Record<string, string>;
      } catch {
        return json({ status: "error", message: "Invalid JSON body." }, 400);
      }

      const product = adminBody.product?.trim();
      const key = sanitizeKey(adminBody.key ?? "");
      const search = (adminBody.search ?? "").trim();

      if (url.pathname === "/api/v1/admin/create-key") {
        return handleAdminCreateKey(env, product, key);
      }
      if (url.pathname === "/api/v1/admin/list-keys") {
        return handleAdminListKeys(env, product, search);
      }
      return handleAdminDeleteKey(env, product, key);
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
}




