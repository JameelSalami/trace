import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/**
 * Encode *only* data representable as canonical JSON. TypeScript's JsonValue
 * is compile-time guidance: replay evaluators and JavaScript callers can still
 * return a Date, Map, sparse array or another invalid runtime value.
 *
 * Do not use JSON.stringify(value) as a validator: it calls toJSON, silently
 * drops undefined/symbol properties, and turns sparse elements into null.
 */
const canonical = (value: unknown, active: WeakSet<object>, path: string): string => {
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("TracePack JSON numbers must be finite at " + path);
    }
    return JSON.stringify(value);
  }
  if (typeof value !== "object") {
    throw new TypeError("TracePack non-JSON value at " + path);
  }
  if (active.has(value)) {
    throw new TypeError("TracePack cyclic JSON value at " + path);
  }

  const isArray = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (isArray ? prototype !== Array.prototype
              : prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("TracePack JSON values must be plain objects or arrays at " + path);
  }

  active.add(value);
  try {
    if (isArray) {
      const array = value as unknown[];
      // A JSON array has only dense, own data elements and its built-in
      // length. Reject sparse arrays, extra properties and symbol keys.
      if (Reflect.ownKeys(array).length !== array.length + 1) {
        throw new TypeError("TracePack JSON arrays must be dense at " + path);
      }
      const parts: string[] = [];
      for (let index = 0; index < array.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(array, String(index));
        if (!descriptor || !("value" in descriptor)) {
          throw new TypeError("TracePack JSON arrays require own data elements at " + path);
        }
        parts.push(canonical(descriptor.value, active, path + "[" + index + "]"));
      }
      return "[" + parts.join(",") + "]";
    }

    const keys = Reflect.ownKeys(value);
    if (keys.some(key => typeof key !== "string")) {
      throw new TypeError("TracePack JSON objects cannot have symbol keys at " + path);
    }
    const record = value as Record<string, unknown>;
    const entries: string[] = [];
    for (const key of (keys as string[]).sort()) {
      const descriptor = Object.getOwnPropertyDescriptor(record, key);
      if (!descriptor?.enumerable || !("value" in descriptor)) {
        throw new TypeError("TracePack JSON objects require enumerable data properties at " + path);
      }
      entries.push(JSON.stringify(key) + ":" +
        canonical(descriptor.value, active, path + "." + key));
    }
    return "{" + entries.join(",") + "}";
  } finally {
    // Shared subobjects are valid JSON values; only actual cycles are refused.
    active.delete(value);
  }
};

export const canonicalJson = (value: JsonValue): string =>
  canonical(value, new WeakSet<object>(), "$");

export const semanticDigest = (value: JsonValue): string =>
  "sha256:" + bytesToHex(sha256(utf8ToBytes(canonicalJson(value))));

export const isSha256 = (value: string): boolean => /^sha256:[a-f0-9]{64}$/.test(value);
