import type { Env, ProductConfig, ProductId } from "./types";

export const PRODUCTS: Record<ProductId, ProductConfig> = {
  hammer: {
    id: "hammer",
    label: "Hammer Activator",
    keysOwner: "HAMMER_KEYS_OWNER",
    keysRepo: "HAMMER_KEYS_REPO",
    keysPat: "HAMMER_KEYS_PAT",
    hwidOwner: "HAMMER_HWID_OWNER",
    hwidRepo: "HAMMER_HWID_REPO",
    hwidPat: "HAMMER_HWID_PAT",
    hwidExtension: ".user",
    hwidLookupExtensions: [".user"],
  },
  "valveoff-win": {
    id: "valveoff-win",
    label: "Valve OFF (Windows)",
    keysOwner: "VALVEOFF_KEYS_OWNER",
    keysRepo: "VALVEOFF_KEYS_REPO",
    keysPat: "VALVEOFF_KEYS_PAT",
    hwidOwner: "VALVEOFF_HWID_OWNER",
    hwidRepo: "VALVEOFF_HWID_REPO",
    hwidPat: "VALVEOFF_HWID_PAT",
    hwidExtension: ".user3",
    hwidLookupExtensions: [".user3"],
  },
  "valveoff-linux": {
    id: "valveoff-linux",
    label: "Valve OFF (Linux)",
    keysOwner: "VALVEOFF_KEYS_OWNER",
    keysRepo: "VALVEOFF_KEYS_REPO",
    keysPat: "VALVEOFF_KEYS_PAT",
    hwidOwner: "VALVEOFF_HWID_OWNER",
    hwidRepo: "VALVEOFF_HWID_REPO",
    hwidPat: "VALVEOFF_HWID_PAT",
    hwidExtension: ".user4",
    hwidLookupExtensions: [".user4"],
  },
};

export function getProduct(id: string): ProductConfig | null {
  return PRODUCTS[id as ProductId] ?? null;
}

export function resolveRepo(
  env: Env,
  product: ProductConfig,
  kind: "keys" | "hwid"
): { owner: string; repo: string; pat: string } {
  if (kind === "keys") {
    return {
      owner: env[product.keysOwner],
      repo: env[product.keysRepo],
      pat: env[product.keysPat],
    };
  }
  return {
    owner: env[product.hwidOwner],
    repo: env[product.hwidRepo],
    pat: env[product.hwidPat],
  };
}
