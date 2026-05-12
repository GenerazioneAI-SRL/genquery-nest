import { BadRequestException } from "@nestjs/common";
import type { GenQueryInput } from "@generazioneai/genquery";

/**
 * The five canonical top-level keys of `GenQueryInput`.
 */
export const CANONICAL_GENQUERY_KEYS = [
  "searchBy",
  "orderBy",
  "select",
  "include",
  "pagination",
] as const;

export type CanonicalGenQueryKey = (typeof CANONICAL_GENQUERY_KEYS)[number];

/**
 * Map each canonical key to its external name. Anything left unset keeps the
 * canonical name. Example:
 *
 *   { searchBy: "filter", orderBy: "sort" }
 *
 * Would read `filter` / `sort` from the incoming object and translate them
 * back to `searchBy` / `orderBy` for the engine.
 */
export type GenQueryKeyMapping = {
  [K in CanonicalGenQueryKey]?: string;
};

export interface GenQueryMappingOptions {
  /** External-name → canonical-name aliases. Defaults to identity. */
  keys?: GenQueryKeyMapping;
  /** Which canonical keys are honored. Defaults to all five. */
  allow?: readonly CanonicalGenQueryKey[];
  /**
   * Reject unexpected keys (anything that is not a configured external name
   * for one of the allowed canonical keys) instead of silently dropping them.
   * Defaults to `false`.
   */
  strict?: boolean;
  /**
   * Parse the value of each canonical key as JSON when it arrives as a string.
   * Useful for query strings like `?searchBy={"firstName":"ada"}` instead of
   * the bracket-notation form `?searchBy[firstName]=ada`.
   *
   *  - `"auto"` (default) — only parse when the trimmed string starts with
   *    `{` or `[`. Bare strings (`orderBy=createdAt`, `pagination=all`) are
   *    passed through untouched, so JSON and shorthand forms coexist.
   *  - `true`  — always attempt `JSON.parse` on string values. Invalid JSON
   *    becomes a `BadRequestException`.
   *  - `false` — never parse; pass strings through as-is.
   */
  parseJson?: boolean | "auto";
}

const IDENTITY_KEYS: Required<GenQueryKeyMapping> = {
  searchBy: "searchBy",
  orderBy: "orderBy",
  select: "select",
  include: "include",
  pagination: "pagination",
};

/**
 * Translate a raw object (HTTP body or query) into a `GenQueryInput`, applying
 * an optional key mapping and allowlist. Pure function — no DI, no I/O.
 *
 *   mapToGenQueryInput(
 *     { filter: { name: "mario" }, sort: "createdAt" },
 *     { keys: { searchBy: "filter", orderBy: "sort" } },
 *   );
 *   // → { searchBy: { name: "mario" }, orderBy: "createdAt" }
 */
export function mapToGenQueryInput<T = unknown>(
  raw: unknown,
  options: GenQueryMappingOptions = {},
): GenQueryInput<T> {
  if (raw === undefined || raw === null) return {} as GenQueryInput<T>;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new BadRequestException(
      "GenQuery input must be an object — received " +
        (Array.isArray(raw) ? "an array" : typeof raw),
    );
  }

  const allow = new Set<CanonicalGenQueryKey>(
    options.allow ?? CANONICAL_GENQUERY_KEYS,
  );
  const keys = { ...IDENTITY_KEYS, ...options.keys };

  // Build the reverse lookup: external name → canonical key, restricted to
  // allowed canonical keys. This is also what `strict` validates against.
  const externalToCanonical = new Map<string, CanonicalGenQueryKey>();
  for (const canonical of CANONICAL_GENQUERY_KEYS) {
    if (!allow.has(canonical)) continue;
    externalToCanonical.set(keys[canonical], canonical);
  }

  const source = raw as Record<string, unknown>;
  const parseMode = options.parseJson ?? "auto";
  const output: Partial<Record<CanonicalGenQueryKey, unknown>> = {};
  const unexpected: string[] = [];

  for (const externalKey of Object.keys(source)) {
    const canonical = externalToCanonical.get(externalKey);
    if (canonical) {
      output[canonical] = maybeParseJson(
        source[externalKey],
        parseMode,
        externalKey,
      );
    } else if (options.strict) {
      unexpected.push(externalKey);
    }
  }

  if (unexpected.length > 0) {
    throw new BadRequestException({
      message: "Unexpected key(s) in GenQuery input",
      unexpected,
      allowed: Array.from(externalToCanonical.keys()),
    });
  }

  return output as GenQueryInput<T>;
}

function maybeParseJson(
  value: unknown,
  mode: boolean | "auto",
  externalKey: string,
): unknown {
  if (mode === false || typeof value !== "string") return value;
  if (mode === "auto") {
    const head = value.trimStart()[0];
    if (head !== "{" && head !== "[") return value;
  }
  try {
    return JSON.parse(value);
  } catch (err) {
    throw new BadRequestException({
      message: `Invalid JSON for query key "${externalKey}"`,
      detail: (err as Error).message,
    });
  }
}

/**
 * Merge a default option set with an override. Used by
 * `createGenQueryDecorator` so a project-wide decorator can be tweaked at the
 * call site.
 */
export function mergeGenQueryMappingOptions(
  defaults: GenQueryMappingOptions | undefined,
  override: GenQueryMappingOptions | undefined,
): GenQueryMappingOptions {
  if (!defaults) return override ?? {};
  if (!override) return defaults;
  return {
    keys: { ...defaults.keys, ...override.keys },
    allow: override.allow ?? defaults.allow,
    strict: override.strict ?? defaults.strict,
    parseJson: override.parseJson ?? defaults.parseJson,
  };
}
