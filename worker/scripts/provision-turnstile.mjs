import { readFileSync, writeFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKER_ROOT = join(__dirname, "..");
const DOCS_CONFIG = join(WORKER_ROOT, "..", "docs", "config.js");
const SECRETS_FILE = join(WORKER_ROOT, "secrets.local.env");

const ACCOUNT_ID = "a0f0419093eb43ef0e671a0f3d96cb3e";
const WIDGET_NAME = "ActivateMe";
const DOMAINS = ["hammeractivation.github.io"];

function readSecretsFile() {
  if (!existsSync(SECRETS_FILE)) return new Map();
  const map = new Map();
  for (const line of readFileSync(SECRETS_FILE, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const idx = trimmed.indexOf("=");
    map.set(trimmed.slice(0, idx).trim(), trimmed.slice(idx + 1).trim());
  }
  return map;
}

function upsertEnvLine(filePath, key, value) {
  let lines = [];
  if (existsSync(filePath)) {
    lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  }
  const prefix = `${key}=`;
  let found = false;
  lines = lines.map((line) => {
    if (line.startsWith(prefix)) {
      found = true;
      return `${key}=${value}`;
    }
    return line;
  });
  if (!found) lines.push(`${key}=${value}`);
  writeFileSync(
    filePath,
    lines.filter((l, i, a) => l !== "" || i < a.length - 1).join("\n") + "\n",
    "utf8"
  );
}

function updateConfigJs(sitekey) {
  let text = readFileSync(DOCS_CONFIG, "utf8");
  if (/window\.TURNSTILE_SITE_KEY\s*=/.test(text)) {
    text = text.replace(
      /window\.TURNSTILE_SITE_KEY\s*=\s*["'][^"']*["']\s*;?/,
      `window.TURNSTILE_SITE_KEY = "${sitekey}";`
    );
  } else {
    text = text.trimEnd() + `\nwindow.TURNSTILE_SITE_KEY = "${sitekey}";\n`;
  }
  writeFileSync(DOCS_CONFIG, text, "utf8");
}

async function cfApi(token, path, options = {}) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  const data = await res.json();
  if (!data.success) {
    const err = data.errors?.map((e) => e.message).join("; ") ?? `HTTP ${res.status}`;
    throw new Error(err);
  }
  return data.result;
}

async function ensureWidget(token) {
  const widgets = await cfApi(token, `/accounts/${ACCOUNT_ID}/challenges/widgets`);
  const existing = widgets.find((w) => w.name === WIDGET_NAME);
  if (existing?.sitekey) {
    const detail = await cfApi(
      token,
      `/accounts/${ACCOUNT_ID}/challenges/widgets/${existing.sitekey}`
    );
    if (detail.secret) {
      return { sitekey: detail.sitekey, secret: detail.secret, created: false };
    }
    const rotated = await cfApi(
      token,
      `/accounts/${ACCOUNT_ID}/challenges/widgets/${existing.sitekey}/rotate_secret`,
      { method: "POST", body: JSON.stringify({ invalidate_immediately: true }) }
    );
    return { sitekey: existing.sitekey, secret: rotated.secret, created: false };
  }

  const created = await cfApi(token, `/accounts/${ACCOUNT_ID}/challenges/widgets`, {
    method: "POST",
    body: JSON.stringify({
      name: WIDGET_NAME,
      domains: DOMAINS,
      mode: "managed",
    }),
  });
  return { sitekey: created.sitekey, secret: created.secret, created: true };
}

function printSetupHelp() {
  console.error(`
Turnstile setup needs a Cloudflare API token with "Turnstile Sites Write".

Option A — API token (automated):
  1. Open: https://dash.cloudflare.com/profile/api-tokens
  2. Create token → Edit Turnstile (or custom with Turnstile Sites Write)
  3. Add to secrets.local.env:
     CLOUDFLARE_API_TOKEN=your_token_here
  4. Run: .\\enable-turnstile.cmd

Option B — Dashboard (manual):
  1. Open: https://dash.cloudflare.com/?to=/:account/turnstile
  2. Add widget → domain: hammeractivation.github.io → mode: Managed
  3. Add to secrets.local.env:
     TURNSTILE_SITE_KEY=your_site_key
     TURNSTILE_SECRET_KEY=your_secret_key
  4. Run: .\\enable-turnstile.cmd
`);
}

async function main() {
  const secrets = readSecretsFile();
  const manualSite = secrets.get("TURNSTILE_SITE_KEY")?.trim();
  const manualSecret = secrets.get("TURNSTILE_SECRET_KEY")?.trim();

  let sitekey;
  let secret;
  let created = false;

  if (manualSite && manualSecret) {
    sitekey = manualSite;
    secret = manualSecret;
    console.log("Using TURNSTILE_SITE_KEY + TURNSTILE_SECRET_KEY from secrets.local.env");
  } else {
    const apiToken =
      process.env.CLOUDFLARE_API_TOKEN?.trim() ||
      secrets.get("CLOUDFLARE_API_TOKEN")?.trim();
    if (!apiToken) {
      printSetupHelp();
      process.exit(1);
    }
    const result = await ensureWidget(apiToken);
    sitekey = result.sitekey;
    secret = result.secret;
    created = result.created;
  }

  upsertEnvLine(SECRETS_FILE, "TURNSTILE_SECRET_KEY", secret);
  updateConfigJs(sitekey);

  console.log(`Turnstile ${created ? "widget created" : "configured"}: ${WIDGET_NAME}`);
  console.log(`Site key (public): ${sitekey}`);
  console.log("Updated docs/config.js and secrets.local.env");
}

main().catch((err) => {
  console.error(err.message || err);
  printSetupHelp();
  process.exit(1);
});
