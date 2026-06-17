export type ProductId =
  | "hammer"
  | "valveoff-win"
  | "valveoff-linux"
  | "onetap"
  | "gamenative";

export type CodeMode = "code42" | "dynamic";

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

  ONETAP_KEYS_OWNER: string;
  ONETAP_KEYS_REPO: string;
  ONETAP_HWID_OWNER: string;
  ONETAP_HWID_REPO: string;

  GAMENATIVE_KEYS_OWNER: string;
  GAMENATIVE_KEYS_REPO: string;
  GAMENATIVE_HWID_OWNER: string;
  GAMENATIVE_HWID_REPO: string;

  HAMMER_KEYS_PAT: string;
  HAMMER_HWID_PAT: string;
  VALVEOFF_KEYS_PAT: string;
  VALVEOFF_HWID_PAT: string;
  ONETAP_KEYS_PAT: string;
  ONETAP_HWID_PAT: string;
  GAMENATIVE_KEYS_PAT: string;
  GAMENATIVE_HWID_PAT: string;
  KEYGEN_ADMIN_TOKEN?: string;
  DISCORD_WEBHOOK_URL?: string;
  TURNSTILE_SECRET_KEY?: string;
}

export interface ProductConfig {
  id: ProductId;
  label: string;
  codeMode: CodeMode;
  keysOwner: keyof Pick<
    Env,
    | "HAMMER_KEYS_OWNER"
    | "VALVEOFF_KEYS_OWNER"
    | "ONETAP_KEYS_OWNER"
    | "GAMENATIVE_KEYS_OWNER"
  >;
  keysRepo: keyof Pick<
    Env,
    | "HAMMER_KEYS_REPO"
    | "VALVEOFF_KEYS_REPO"
    | "ONETAP_KEYS_REPO"
    | "GAMENATIVE_KEYS_REPO"
  >;
  keysPat: keyof Pick<
    Env,
    | "HAMMER_KEYS_PAT"
    | "VALVEOFF_KEYS_PAT"
    | "ONETAP_KEYS_PAT"
    | "GAMENATIVE_KEYS_PAT"
  >;
  hwidOwner: keyof Pick<
    Env,
    | "HAMMER_HWID_OWNER"
    | "VALVEOFF_HWID_OWNER"
    | "ONETAP_HWID_OWNER"
    | "GAMENATIVE_HWID_OWNER"
  >;
  hwidRepo: keyof Pick<
    Env,
    | "HAMMER_HWID_REPO"
    | "VALVEOFF_HWID_REPO"
    | "ONETAP_HWID_REPO"
    | "GAMENATIVE_HWID_REPO"
  >;
  hwidPat: keyof Pick<
    Env,
    | "HAMMER_HWID_PAT"
    | "VALVEOFF_HWID_PAT"
    | "ONETAP_HWID_PAT"
    | "GAMENATIVE_HWID_PAT"
  >;
  hwidExtension: string;
  hwidLookupExtensions: string[];
}

export interface ApiResponse {
  status: string;
  message?: string;
  datePH?: string;
  retryAfter?: number;
  ready?: boolean;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfter?: number;
}
