export type ProductId = "hammer" | "valveoff-win" | "valveoff-linux";

export interface Env {
  RATE_LIMIT: KVNamespace;

  HAMMER_KEYS_OWNER: string;
  HAMMER_KEYS_REPO: string;
  HAMMER_HWID_OWNER: string;
  HAMMER_HWID_REPO: string;

  VALVEOFF_KEYS_OWNER: string;
  VALVEOFF_KEYS_REPO: string;
  VALVEOFF_HWID_OWNER: string;
  VALVEOFF_HWID_REPO: string;

  HAMMER_KEYS_PAT: string;
  HAMMER_HWID_PAT: string;
  VALVEOFF_KEYS_PAT: string;
  VALVEOFF_HWID_PAT: string;
  DISCORD_WEBHOOK_URL?: string;
}

export interface ProductConfig {
  id: ProductId;
  label: string;
  keysOwner: keyof Pick<
    Env,
    "HAMMER_KEYS_OWNER" | "VALVEOFF_KEYS_OWNER"
  >;
  keysRepo: keyof Pick<Env, "HAMMER_KEYS_REPO" | "VALVEOFF_KEYS_REPO">;
  keysPat: keyof Pick<Env, "HAMMER_KEYS_PAT" | "VALVEOFF_KEYS_PAT">;
  hwidOwner: keyof Pick<Env, "HAMMER_HWID_OWNER" | "VALVEOFF_HWID_OWNER">;
  hwidRepo: keyof Pick<Env, "HAMMER_HWID_REPO" | "VALVEOFF_HWID_REPO">;
  hwidPat: keyof Pick<Env, "HAMMER_HWID_PAT" | "VALVEOFF_HWID_PAT">;
  hwidExtension: string;
  hwidLookupExtensions: string[];
}

export interface ApiResponse {
  status: string;
  message?: string;
  datePH?: string;
  retryAfter?: number;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfter?: number;
}
