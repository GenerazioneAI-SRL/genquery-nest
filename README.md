# @generazioneai/genquery-nestjs

NestJS module for [`@generazioneai/genquery`](https://github.com/GenerazioneAI-SRL/genquery) — exposes the Prisma-backed `GenQueryEngine` as an injectable provider.

Frontends send a `GenQueryInput` JSON object. The engine validates it against a schema derived from your Prisma datamodel (DMMF) and translates it into `findMany` / `findFirst` argument objects. This package wires that engine into the Nest DI container, plus the HTTP glue around it: a parameter decorator that reads the input off the request, typed Swagger helpers, and a federation transport for gateways.

## Install

```bash
npm install @generazioneai/genquery-nestjs @generazioneai/genquery
# peer deps (most apps already have these)
npm install @nestjs/common @nestjs/core @prisma/client reflect-metadata rxjs
```

`@prisma/client` and `@nestjs/swagger` are **optional** peers: the former is your own generated client, the latter is only needed when importing the `/swagger` subpath.

## Quick start

```typescript
// app.module.ts
import { Module } from "@nestjs/common";
import { GenQueryModule } from "@generazioneai/genquery-nestjs";
import { Prisma } from "@prisma/client";
import { PrismaService } from "./prisma.service";

@Module({
  imports: [
    GenQueryModule.forPrismaRoot({
      prisma: PrismaService,                    // DI token of your PrismaClient
      datamodel: Prisma.dmmf.datamodel,
      schema: { models: ["User", "Post"] },     // optional: restrict to specific models
    }),
  ],
})
export class AppModule {}
```

```typescript
// users.service.ts
import { Injectable } from "@nestjs/common";
import {
  GenQueryEngine,
  GenQueryInput,
  InjectGenQueryEngine,
} from "@generazioneai/genquery-nestjs";
import { PrismaService } from "./prisma.service";

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectGenQueryEngine()
    private readonly engine: GenQueryEngine<any, any>,
  ) {}

  // `engine.run` is async and resolves to `{ data, current?, total? }`
  // (see "Result shape" below). The root entity name must be passed
  // explicitly — Prisma delegates don't expose it.
  search(input: GenQueryInput) {
    return this.engine.run(input, "User", this.prisma.user);
  }
}
```

```typescript
// users.controller.ts
import { GenQuery, GenQueryInput } from "@generazioneai/genquery-nestjs";

@Controller("users")
export class UsersController {
  constructor(private readonly users: UsersService) {}

  // GET /users?searchBy[firstName]=mario&orderBy=createdAt&pagination[perPage]=20
  @Get()
  list(@GenQuery() input: GenQueryInput) {
    return this.users.search(input);
  }
}
```

`@GenQuery()` auto-picks the request surface: `request.query` for `GET`/`HEAD`, `request.body` otherwise. So the same decorator works for both:

```typescript
// REST-conventional read
@Get()
list(@GenQuery() input: GenQueryInput) { /* reads query */ }

// POST /search for very complex / deeply nested queries that would be ugly as
// a URL — URL length limits, types stay typed, payload kept out of access logs.
@Post("search")
search(@GenQuery() input: GenQueryInput) { /* reads body */ }

// Force a specific source when needed:
@Get()
list(@GenQuery({ from: "query" }) input: GenQueryInput) { /* ... */ }
```

Express's default `qs` parser handles nested query strings out of the box (`?searchBy[firstName]=mario&pagination[page]=0` → nested objects). All values arrive as strings — fine for `string` / `enum` / date fields, but for `number` / `boolean` filters either pass whole-JSON values per key (see [JSON strings in the query](#passing-json-strings-in-the-query)) or use POST with a JSON body.

For the full query language reference (search modes, date ranges, OR, relations, pagination, etc.) see the [upstream docs](https://github.com/GenerazioneAI-SRL/genquery#documentation).

## Result shape

`engine.run` is async and resolves to a `PaginatedResult<T>` (re-exported from this package):

```typescript
interface PaginatedResult<T> {
  data: T[];
  current?: number;   // rows in this page (when pagination.showNumber is true)
  total?: number;     // rows matching the query without pagination (when pagination.showTotal is true)
}
```

Both flags default to `true`, so a plain `engine.run(input, "User", prisma.user)` returns `{ data, current, total }`. Opt out via the input:

```typescript
engine.run(
  { searchBy: { firstName: "mario" }, pagination: { page: 0, perPage: 20, showTotal: false } },
  "User",
  prisma.user,
);
// → { data, current }   ← no parallel `count` query
```

`showTotal: false` skips the extra `count` (faster on large tables); `showNumber: false` omits `data.length` from the response (cosmetic). When you need full control over execution — custom chaining, transactions, your own `findMany` call — use `engine.parse` + `engine.runParsed` instead (sync, returns the Prisma args object without executing).

## Configuration

### Sync — `GenQueryModule.forPrismaRoot(options)`

```typescript
GenQueryModule.forPrismaRoot({
  prisma: PrismaService,                          // required: DI token of the Prisma client
  datamodel: Prisma.dmmf.datamodel,               // required: drives schema derivation
  // Optional schema introspection options (forwarded to `schemaFromPrisma`).
  schema: {
    models: ["User", "Post"],                     // restrict to specific models
    overrides: { User: { metadata: "string" } },  // map non-standard columns
  },
  // Optional Prisma adapter options.
  adapter: { parallelCount: false },
});
```

| Option      | Type                                     | Default       | Purpose                                                              |
|-------------|------------------------------------------|---------------|----------------------------------------------------------------------|
| `name`      | `string`                                 | `"default"`   | Register a named engine (see [Multiple engines](#multiple-engines)). |
| `prisma`    | `string \| symbol \| Function \| Type`   | — (required)  | DI token resolving to your `PrismaClient` / `PrismaService`.         |
| `datamodel` | `PrismaDatamodel`                        | — (required)  | `Prisma.dmmf.datamodel` (or structurally equivalent).                |
| `schema`    | `SchemaFromPrismaOptions`                | `{}`          | Forwarded to `schemaFromPrisma`.                                     |
| `adapter`   | `PrismaAdapterOptions`                   | `{}`          | Forwarded to the `PrismaAdapter` constructor.                        |
| `policy`    | `GenQueryPolicyInput`                    | —             | Auto-build the allowlist policy from resource manifests (see below). |
| `model`     | `string`                                 | —             | Early-fail check that the client has a delegate for this model.      |
| `global`    | `boolean`                                | `false`       | Register the module as global (mirrors `ConfigModule.isGlobal`).     |

### Async — `GenQueryModule.forPrismaRootAsync(options)`

Use this when options depend on injected services (e.g. a config service).

```typescript
GenQueryModule.forPrismaRootAsync({
  prisma: PrismaService,
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    datamodel: Prisma.dmmf.datamodel,
    schema:  { overrides: config.get("genquery.overrides") },
    adapter: { parallelCount: config.get("genquery.parallelCount") },
  }),
});
```

Also supports `useClass` / `useExisting` with a class that implements `GenQueryPrismaOptionsFactory`:

```typescript
@Injectable()
class GenQueryConfig implements GenQueryPrismaOptionsFactory {
  createGenQueryPrismaOptions() {
    return { datamodel: Prisma.dmmf.datamodel };
  }
}

GenQueryModule.forPrismaRootAsync({ prisma: PrismaService, useClass: GenQueryConfig });
```

`name` and `prisma` stay on the top-level call (they determine the DI tokens — the engine token and the client to inject — which must be known synchronously); `datamodel` / `schema` / `adapter` / `policy` flow through the factory.

### Policy from resource manifests

Instead of pre-building an `EntityPolicy` map by hand, pass your resource manifests through the `policy` option and the module derives a DENY-based policy (canonical secret fields excluded) over the same `datamodel` via `buildGenQueryPolicy`:

```typescript
GenQueryModule.forPrismaRoot({
  prisma: PrismaService,
  datamodel: Prisma.dmmf.datamodel,
  policy: {
    resources: RESOURCE_MANIFESTS,                  // drives maxPerPage etc.
    deny: { User: { fields: ["internalNotes"] } },  // per-model extra deny
    extraSecretFields: ["legacyHash"],              // beyond DEFAULT_SECRET_FIELDS
  },
});
```

The result is merged into `schema.policy`; an explicit `schema.policy` entry wins over the auto-built one (override hook).

## Multiple engines

Register more than one engine by passing distinct `name` values. Inject each by name:

```typescript
@Module({
  imports: [
    GenQueryModule.forPrismaRoot({
      prisma: PrismaService,
      datamodel: Prisma.dmmf.datamodel,
    }),                                             // default engine
    GenQueryModule.forPrismaRoot({
      name: "strict",
      prisma: PrismaService,
      datamodel: Prisma.dmmf.datamodel,
      schema: { models: ["User"] },
    }),
  ],
})
export class AppModule {}
```

```typescript
constructor(
  @InjectGenQueryEngine()         private readonly defaultEngine: GenQueryEngine<any, any>,
  @InjectGenQueryEngine("strict") private readonly strictEngine:  GenQueryEngine<any, any>,
) {}
```

Different `prisma` tokens per engine work the same way — useful when an app talks to more than one database through distinct Prisma clients.

## Renaming wire keys / picking which keys to honor

`GenQueryInput` uses the canonical keys `searchBy`, `orderBy`, `select`, `include`, `pagination`. Public APIs often want different names (`filter`, `sort`, `fields`, `with`, `page`) and may want to expose only some of them. The `@GenQuery()` parameter decorator handles the translation.

```typescript
import { GenQuery, GenQueryInput } from "@generazioneai/genquery-nestjs";

@Controller("users")
export class UsersController {
  // GET /users?filter[firstName]=mario&sort=createdAt&page[perPage]=20
  @Get()
  list(
    @GenQuery({
      keys:   { searchBy: "filter", orderBy: "sort", pagination: "page" },
      allow:  ["searchBy", "orderBy", "pagination"],   // ignore select/include
      strict: true,                                    // throw 400 on unknown keys
    })
    input: GenQueryInput,
  ) {
    return this.users.search(input);    // → { data, current?, total? }
  }
}
```

The decorator rewrites the parsed query string

```
{ "filter": { "firstName": "mario" }, "sort": "createdAt", "page": { "perPage": "20" } }
```

into canonical form before handing it to your handler. Keys not listed in `allow` are silently dropped (or rejected with `BadRequestException` when `strict: true`).

The same decorator works on `@Post()` endpoints — it reads the body instead. Use POST when query strings get unwieldy (deeply nested OR conditions, mixed-type filters, URL length over a few KB).

### Options

| Option   | Type                                | Default       | Purpose                                                            |
|----------|-------------------------------------|---------------|--------------------------------------------------------------------|
| `keys`   | `Partial<Record<CanonicalKey, string>>` | identity      | Map canonical → external name. Unmapped keys keep their name.      |
| `allow`  | `readonly CanonicalGenQueryKey[]`   | all five      | Whitelist of canonical keys to honor.                              |
| `strict` | `boolean`                           | `false`       | Throw on keys that are neither mapped nor in `allow`.              |
| `parseJson` | `boolean \| "auto"`              | `"auto"`      | `auto` = parse string values that start with `{`/`[`. Lets `?searchBy={...}` and `?orderBy=createdAt` coexist. `true` always parses (400 on invalid JSON), `false` disables. |
| `from`   | `"auto" \| "query" \| "body"`       | `"auto"`      | `auto` = `query` for GET/HEAD, `body` otherwise. Override to force one. |

### Project-wide defaults

To avoid repeating the same options on every endpoint, bake them into a custom decorator with `createGenQueryDecorator`:

```typescript
// shared/search-input.decorator.ts
import { createGenQueryDecorator } from "@generazioneai/genquery-nestjs";

export const SearchInput = createGenQueryDecorator({
  keys:   { searchBy: "filter", orderBy: "sort", pagination: "page" },
  allow:  ["searchBy", "orderBy", "pagination"],
  strict: true,
});
```

```typescript
@Get()
list(@SearchInput() input: GenQueryInput) { ... }

// Per-endpoint override merges over the defaults:
@Get("export")
exportAll(@SearchInput({ allow: ["searchBy"] }) input: GenQueryInput) { ... }
```

### Passing JSON strings in the query

`@GenQuery()` also accepts whole-JSON values per top-level key, so the wire form

```
GET /users?searchBy={"firstName":"ada"}&orderBy={"field":"createdAt","order":"desc"}&pagination={"page":0,"perPage":20}
```

is parsed as

```typescript
{
  searchBy:   { firstName: "ada" },
  orderBy:    { field: "createdAt", order: "desc" },
  pagination: { page: 0, perPage: 20 },
}
```

The default `parseJson: "auto"` only kicks in when the string starts with `{` or `[`, so bare-string shorthands keep working on the same endpoint:

```
GET /users?orderBy=createdAt&pagination=all
```

…stays a plain string `"createdAt"` / `"all"` (which the engine accepts). Invalid JSON in a value that clearly tried to be JSON (`?searchBy={broken`) yields a `BadRequestException`. Set `parseJson: false` to disable the behavior, or `parseJson: true` to require JSON for every value.

> ℹ Remember to URL-encode the JSON value (`encodeURIComponent`) — most clients do this automatically.

### GET vs POST — when to use which

`@GenQuery()` works on both. Pick by what you're transporting:

- **GET (default for read endpoints)** — REST-conventional, idempotent, cacheable, bookmarkable. Good when filters are mostly strings/enums and the query is shallow. Express's `qs` parser turns `?filter[firstName]=mario&page[page]=0` into nested objects automatically. Caveat: every value arrives as a string — pass whole-JSON values per key to keep native types, or fall back to POST.
- **POST** (`/resource/search` or similar) — when the query is large, deeply nested (OR conditions, multiple relation filters), or contains many typed values you'd rather not stringify. URL length limits and access-log noise also matter for sensitive filters. The decorator reads `request.body` here without any extra config.

The `"auto"` default routes correctly for both styles, so the same decorator stays in place when you move an endpoint between methods.

For flat query params (`?page=0&perPage=20` instead of `?page[page]=0&page[perPage]=20`) preprocess in a Pipe — the mapping decorator only renames top-level keys, it doesn't reshape nested values.

### Standalone helper

The translation is a pure function — usable outside controllers (tests, message handlers, custom pipes):

```typescript
import { mapToGenQueryInput } from "@generazioneai/genquery-nestjs";

const input = mapToGenQueryInput(rawJson, {
  keys: { searchBy: "filter" },
  allow: ["searchBy", "pagination"],
});
```

## Swagger helpers — `/swagger` subpath

The `@generazioneai/genquery-nestjs/swagger` subpath ships typed Swagger decorators for gateways exposing genquery endpoints over HTTP. It requires `@nestjs/swagger` (optional peer) — engine-only backends never load it.

```typescript
import {
  GenQueryDto,
  ApiOkData,
  ApiCreatedData,
  ApiPaginatedData,
  ApiIdParam,
  ApiFindOneQuery,
  ApiListQueries,
} from "@generazioneai/genquery-nestjs/swagger";

@Controller("users")
export class UsersController {
  @Get()
  @ApiPaginatedData(UserEntity)           // 200 — { success, data: UserEntity[], meta }
  @ApiListQueries("User")                 // documents searchBy/orderBy/pagination/include/select
  list(@GenQuery({ from: "query" }) genquery: GenQueryDto) { /* ... */ }

  @Get(":id")
  @ApiOkData(UserEntity)                  // 200 — { success, data: UserEntity }
  @ApiIdParam()                           // UUID path param
  findOne(@Param("id") id: string) { /* ... */ }

  @Post()
  @ApiCreatedData(UserEntity)             // 201 — { success, data: UserEntity }
  create(@Body() dto: CreateUserDto) { /* ... */ }
}
```

- `GenQueryDto` — permissive DTO for the genquery envelope (`searchBy` / `orderBy` / `select` / `include` / `pagination`); validation is delegated to the engine's per-model policy downstream.
- `ApiOkData` / `ApiCreatedData` / `ApiPaginatedData` — typed success responses inside the standard `{ success, data, meta? }` envelope, with `$ref` to the real Entity/DTO class (auto-registered via `ApiExtraModels`).
- `ApiIdParam` — standard UUID path param.
- `ApiFindOneQuery` / `ApiListQueries` — document the serialized-JSON genquery query params on findOne / list endpoints.

## Federation (gateways)

`GenQueryFederationModule` / `GenQueryFederation` give an orchestrator (typically the API gateway) a federated genquery transport over `ClientProxy.send`: a cmd is dispatched to its owning service and cross-service `include`s are discovered from the datamodel union and resolved automatically — through the target service's own genquery endpoints, so tenant scoping, authz enforcement and field-level read stripping of the **owner** service apply to the included rows.

```typescript
GenQueryFederationModule.forRoot({
  services: [
    { service: "skillID", clientToken: "id", datamodel: idDatamodel },
    { service: "skillHr", clientToken: "hr", datamodel: hrDatamodel },
  ],
  aliasMap: { customer: "Juridical" },     // global semantic aliases (optional)
})
```

```typescript
constructor(private readonly federation: GenQueryFederation) {}

list(genquery: GenQueryDto, tenantId: string) {
  return this.federation.send({
    client: "hr",
    cmd: "structure-juridical-individuals.findAll",
    model: "StructureJuridicalIndividual",
    payload: { juridicalId: tenantId, ...genquery },
  });
}
```

Failed federated includes are best-effort by default (left-join semantics: the key stays `null`, a WARN is logged); set `failFast: true` to propagate instead.

## `rpcCall` — RPC resilience helper

`rpcCall` wraps an RPC `Observable` (e.g. `ClientProxy.send()`) with timeout + retry. It retries **only** transport-level "no responders" errors (a service briefly down during a K8s rolling update) with exponential backoff (1s, 2s, 4s, cap 5s) — business errors (validation, not found, …) are never retried.

```typescript
import { rpcCall } from "@generazioneai/genquery-nestjs";

const result = await rpcCall(this.client.send({ cmd: "users.findAll" }, payload));
// rpcCall(observable, timeoutMs?, maxRetries?) — defaults via env:
//   RPC_TIMEOUT_MS (30000) / RPC_MAX_RETRIES (3)
```

## Error handling

Parse failures throw `QueryValidationError` (re-exported from this package). The `path` field points to the offending location in the input:

```typescript
import { QueryValidationError } from "@generazioneai/genquery-nestjs";

try {
  await this.engine.run(input, "User", this.prisma.user);
} catch (e) {
  if (e instanceof QueryValidationError) {
    throw new BadRequestException({ path: e.path, message: e.message });
  }
  throw e;
}
```

A reusable exception filter is shown in [docs/recipes.md](docs/recipes.md#exception-filter).

## Public API

```typescript
import {
  GenQueryModule,
  InjectGenQueryEngine,
  getGenQueryEngineToken,
  DEFAULT_GENQUERY_ENGINE_NAME,

  // federation (gateways)
  GenQueryFederationModule,
  GenQueryFederation,
  GENQUERY_FEDERATION_OPTIONS,
  FederationServiceConfig,
  GenQueryFederationOptions,
  FederatedSendArgs,
  MessageClientLike,

  // RPC resilience helper
  rpcCall,

  // wire-key remapping
  GenQuery,
  createGenQueryDecorator,
  mapToGenQueryInput,
  mergeGenQueryMappingOptions,
  CANONICAL_GENQUERY_KEYS,
  CanonicalGenQueryKey,
  GenQueryKeyMapping,
  GenQueryMappingOptions,
  GenQueryParamOptions,

  // option types
  GenQueryPrismaModuleOptions,
  GenQueryPrismaModuleAsyncOptions,
  GenQueryPrismaFactoryOptions,
  GenQueryPrismaOptionsFactory,
  GenQueryPolicyInput,
  CreatePrismaEngineOptions,

  // re-exported from @generazioneai/genquery/prisma
  schemaFromPrisma,
  SchemaFromPrismaOptions,
  PrismaAdapterOptions,
  PrismaDatamodel,
  PrismaFindManyArgs,
  PrismaModelDelegate,
  PrismaWhere,

  // re-exported from @generazioneai/genquery
  GenQueryEngine,
  GenQueryInput,
  PaginatedResult,
  ParsedQuery,
  Schema,
  QueryValidationError,
  parseQuery,
  parseDateTime,
  Adapter,
} from "@generazioneai/genquery-nestjs";

import {
  GenQueryDto,
  ApiOkData,
  ApiCreatedData,
  ApiPaginatedData,
  ApiIdParam,
  ApiFindOneQuery,
  ApiListQueries,
} from "@generazioneai/genquery-nestjs/swagger";
```

## Documentation

| File | Contents |
|------|----------|
| [docs/recipes.md](docs/recipes.md) | Controller patterns, exception filter, named engines, testing |
| [Upstream README](https://github.com/GenerazioneAI-SRL/genquery#readme) | Query language and adapter internals |
| [Upstream query reference](https://github.com/GenerazioneAI-SRL/genquery/blob/main/docs/query-reference.md) | Full `GenQueryInput` reference |

## License

[BSD 3-Clause](LICENSE)
