import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

const canonical = (value: JsonValue): string => {
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("TracePack JSON numbers must be finite.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  const record = value as Readonly<Record<string, JsonValue>>;
  return "{" + Object.keys(record)
    .sort()
    .map((key) => JSON.stringify(key) + ":" + canonical(record[key]!))
    .join(",") + "}";
};

export const canonicalJson = (value: JsonValue): string => canonical(value);

export const semanticDigest = (value: JsonValue): string =>
  "sha256:" + bytesToHex(sha256(utf8ToBytes(canonicalJson(value))));

export const isSha256 = (value: string): boolean => /^sha256:[a-f0-9]{64}$/.test(value);