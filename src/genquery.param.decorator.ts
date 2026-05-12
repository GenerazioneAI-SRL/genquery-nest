import { ExecutionContext, createParamDecorator } from "@nestjs/common";
import {
  GenQueryMappingOptions,
  mapToGenQueryInput,
  mergeGenQueryMappingOptions,
} from "./genquery.mapping.js";

/**
 * Per-call options for `@GenQuery(...)` / a custom decorator built with
 * `createGenQueryDecorator(...)`.
 *
 * Extends `GenQueryMappingOptions` with `from`, which selects the request
 * surface to read (HTTP body vs query string).
 */
export interface GenQueryParamOptions extends GenQueryMappingOptions {
  /**
   * Source of the raw object:
   *  - `"auto"` (default) — `request.query` for `GET`/`HEAD`, `request.body`
   *    for any other HTTP method. Mirrors REST conventions: search = GET.
   *  - `"query"` — always `request.query`
   *  - `"body"` — always `request.body`
   */
  from?: "auto" | "query" | "body";
}

function readSource(
  ctx: ExecutionContext,
  from: "auto" | "query" | "body",
): unknown {
  const request = ctx.switchToHttp().getRequest();
  if (from === "query") return request.query;
  if (from === "body") return request.body;
  const method = String(request.method ?? "").toUpperCase();
  return method === "GET" || method === "HEAD" ? request.query : request.body;
}

/**
 * Read the request body (or query string) and translate it into a
 * `GenQueryInput`, applying the supplied key mapping and allowlist.
 *
 *   @Post("search")
 *   search(@GenQuery() input: GenQueryInput<User>) { ... }
 *
 *   @Post("search")
 *   search(
 *     @GenQuery({
 *       keys: { searchBy: "filter", orderBy: "sort" },
 *       allow: ["searchBy", "orderBy", "pagination"],
 *       strict: true,
 *     })
 *     input: GenQueryInput<User>,
 *   ) { ... }
 *
 *   // Read from query string instead of body
 *   @Get()
 *   list(@GenQuery({ from: "query" }) input: GenQueryInput<User>) { ... }
 *
 * For app-wide defaults, build your own decorator with
 * `createGenQueryDecorator(defaults)`.
 */
export const GenQuery: (options?: GenQueryParamOptions) => ParameterDecorator =
  createParamDecorator(
    (options: GenQueryParamOptions | undefined, ctx: ExecutionContext) => {
      const opts = options ?? {};
      const source = readSource(ctx, opts.from ?? "auto");
      return mapToGenQueryInput(source, opts);
    },
  );

/**
 * Build a project-specific parameter decorator with default mapping baked in.
 * Call-site overrides are merged on top of the defaults.
 *
 *   // shared/search-input.decorator.ts
 *   export const SearchInput = createGenQueryDecorator({
 *     keys:   { searchBy: "filter", orderBy: "sort" },
 *     allow:  ["searchBy", "orderBy", "pagination"],
 *     strict: true,
 *   });
 *
 *   // users.controller.ts
 *   @Post("search")
 *   search(@SearchInput() input: GenQueryInput<User>) { ... }
 *
 *   // override on a single endpoint
 *   @Post("export")
 *   export(@SearchInput({ allow: ["searchBy"] }) input: GenQueryInput<User>) { ... }
 *
 * The override is shallow-merged for `keys` and replaces `allow` / `strict` /
 * `from` when present.
 */
export function createGenQueryDecorator(
  defaults: GenQueryParamOptions = {},
): (override?: GenQueryParamOptions) => ParameterDecorator {
  return createParamDecorator(
    (override: GenQueryParamOptions | undefined, ctx: ExecutionContext) => {
      const merged: GenQueryParamOptions = {
        ...mergeGenQueryMappingOptions(defaults, override),
        from: override?.from ?? defaults.from,
      };
      const source = readSource(ctx, merged.from ?? "auto");
      return mapToGenQueryInput(source, merged);
    },
  );
}
