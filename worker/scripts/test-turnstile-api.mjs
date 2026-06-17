import { readFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const configPath = join(
  homedir(),
  "AppData",
  "Roaming",
  "xdg.config",
  ".wrangler",
  "config",
  "default.toml"
);
const config = readFileSync(configPath, "utf8");
const token =
  process.env.CLOUDFLARE_API_TOKEN ??
  config.match(/oauth_token\s*=\s*"([^"]+)"/)?.[1];
const account = "a0f0419093eb43ef0e671a0f3d96cb3e";

const res = await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${account}/challenges/widgets`,
  { headers: { Authorization: `Bearer ${token}` } }
);
const data = await res.json();
console.log(JSON.stringify({ success: data.success, errors: data.errors, count: data.result?.length }));
