# @generazioneai/genquery-nestjs

NestJS module for [`@generazioneai/genquery`](https://github.com/GenerazioneAI-SRL/genquery) — exposes the `GenQueryEngine` (TypeORM adapter) as an injectable provider.

Frontends send a `GenQueryInput` JSON object. The engine validates it against a schema derived from your TypeORM entities and translates it into a `SelectQueryBuilder`. This package wires that engine into the Nest DI container.

## Install

```bash
npm install @generazioneai/genquery-nestjs @generazioneai/genquery
# peer deps (most apps already have these)
npm install @nestjs/common @nestjs/core @nestjs/typeorm typeorm reflect-metadata
```

## Quick start

```typescript
// app.module.ts
import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { GenQueryModule } from "@generazioneai/genquery-nestjs";
import { User, Post } from "./entities";

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: "postgres",
      /* ... */
      entities: [User, Post],
    }),
    GenQueryModule.forRoot(),
  ],
})
export class AppModule {}
```

```typescript
// users.service.ts
import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import {
  GenQueryEngine,
  GenQueryInput,
  InjectGenQueryEngine,
} from "@generazioneai/genquery-nestjs";
import { ObjectLiteral, Repository, SelectQueryBuilder } from "typeorm";
import { User } from "./user.entity";

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectGenQueryEngine()
    private readonly engine: GenQueryEngine<
      SelectQueryBuilder<ObjectLiteral>,
      SelectQueryBuilder<ObjectLiteral>
    >,
  ) {}

  // `engine.run` is async and resolves to `{ data, current?, total? }`
  // (see "Result shape" below).
  search(input: GenQueryInput<User>) {
    const qb = this.users.createQueryBuilder("User");
    return this.engine.run(input, qb);
  }
}
```

```typescript
// users.controller.ts
import { GenQuery } from "@generazioneai/genquery-nestjs";

@Controller("users")
export class UsersController {
  constructor(private readonly users: UsersService) {}

  // GET /users?searchBy[firstName]=mario&orderBy=createdAt&pagination[perPage]=20
  @Get()
  list(@GenQuery() input: GenQueryInput<User>) {
    return this.users.search(input);
  }
}
```

`@GenQuery()` auto-picks the request surface: `request.query` for `GET`/`HEAD`, `request.body` otherwise. So the same decorator works for both:

```typescript
// REST-conventional read
@Get()
list(@GenQuery() input: GenQueryInput<User>) { /* reads query */ }

// POST /search for very complex / deeply nested queries that would be ugly as
// a URL — URL length limits, types stay typed, payload kept out of access logs.
@Post("search")
search(@GenQuery() input: GenQueryInput<User>) { /* reads body */ }

// Force a specific source when needed:
@Get()
list(@GenQuery({ from: "query" }) input: GenQueryInput<User>) { /* ... */ }
```

Express's default `qs` parser handles nested query strings out of the box (`?searchBy[firstName]=mario&pagination[page]=0` → nested objects). All values arrive as strings — fine for `string` / `enum` / date fields, but for `number` / `boolean` filters you'll want a coercion pipe upstream (or use POST with JSON).

The root entity is derived from `qb.expressionMap.mainAlias.metadata.name` at runtime — no need to pass it explicitly. For the full query language reference (search modes, date ranges, OR, relations, pagination, etc.) see the [upstream docs](https://github.com/GenerazioneAI-SRL/genquery#documentation).

## Result shape

`engine.run` is async and resolves to a `PaginatedResult<T>` (re-exported from this package):

```typescript
interface PaginatedResult<T> {
  data: T[];
  current?: number;   // rows in this page (when pagination.showNumber is true)
  total?: number;     // rows matching the query without pagination (when pagination.showTotal is true)
}
```

Both flags default to `true`, so a plain `engine.run(input, qb)` returns `{ data, current, total }`. Opt out via the input:

```typescript
engine.run(
  { searchBy: { firstName: "mario" }, pagination: { page: 0, perPage: 20, showTotal: false } },
  qb,
);
// → { data, current }   ← no second SQL roundtrip for COUNT(*)
```

`showTotal: false` skips the `getManyAndCount` count query (faster on large tables); `showNumber: false` omits `data.length` from the response (cosmetic). When you need full control over execution — custom hydration, streaming, raw SQL — call `engine.runParsed` instead (sync, returns the mutated `SelectQueryBuilder`).

## Configuration

### Sync — `GenQueryModule.forRoot(options?)`

```typescript
GenQueryModule.forRoot({
  // Optional schema introspection options (forwarded to `schemaFromTypeORM`).
  schema: {
    entities: [User, Post],                       // restrict to specific entities
    overrides: { User: { metadata: "string" } },  // map non-standard columns
  },
  // Optional TypeORM adapter options.
  adapter: { paramPrefix: "q" },
});
```

All keys are optional. With no options the engine introspects every entity registered on the default DataSource.

| Option       | Type                                  | Default                   | Purpose                                                            |
|--------------|---------------------------------------|---------------------------|--------------------------------------------------------------------|
| `name`       | `string`                              | `"default"`               | Register a named engine (see [Multiple engines](#multiple-engines)).|
| `dataSource` | `string \| symbol \| Function`        | `getDataSourceToken()`    | DI token of the TypeORM `DataSource` to use.                       |
| `schema`     | `SchemaFromTypeORMOptions`            | `{}`                      | Forwarded to `schemaFromTypeORM`.                                  |
| `adapter`    | `TypeORMAdapterOptions`               | `{}`                      | Forwarded to the `TypeORMAdapter` constructor.                     |

### Async — `GenQueryModule.forRootAsync(options)`

Use this when options depend on injected services (e.g. a config service).

```typescript
GenQueryModule.forRootAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    schema:  { overrides: config.get("genquery.overrides") },
    adapter: { paramPrefix: config.get("genquery.paramPrefix") },
  }),
});
```

Also supports `useClass` / `useExisting` with a class that implements `GenQueryOptionsFactory`:

```typescript
@Injectable()
class GenQueryConfig implements GenQueryOptionsFactory {
  createGenQueryOptions() {
    return { adapter: { paramPrefix: "q" } };
  }
}

GenQueryModule.forRootAsync({ useClass: GenQueryConfig });
```

`name` and `dataSource` stay on the top-level call (they determine the DI token, which must be known synchronously); only `schema` / `adapter` flow through the factory.

## Multiple engines

Register more than one engine by passing distinct `name` values. Inject each by name:

```typescript
@Module({
  imports: [
    TypeOrmModule.forRoot({ /* ... */ }),
    GenQueryModule.forRoot(),                     // default engine
    GenQueryModule.forRoot({
      name: "strict",
      adapter: { paramPrefix: "s" },
    }),
  ],
})
export class AppModule {}
```

```typescript
constructor(
  @InjectGenQueryEngine()         private readonly defaultEngine: GenQueryEngine<...>,
  @InjectGenQueryEngine("strict") private readonly strictEngine:  GenQueryEngine<...>,
) {}
```

## Multiple DataSources

If your app registers more than one TypeORM connection, pass its token name via `dataSource`:

```typescript
TypeOrmModule.forRoot({ name: "reports", /* ... */ });

GenQueryModule.forRoot({
  name: "reports",
  dataSource: "reports",   // resolves to getDataSourceToken("reports")
});
```

## Renaming wire keys / picking which keys to honor

`GenQueryInput` uses the canonical keys `searchBy`, `orderBy`, `select`, `include`, `pagination`. Public APIs often want different names (`filter`, `sort`, `fields`, `with`, `page`) and may want to expose only some of them. The `@GenQuery()` parameter decorator handles the translation.

```typescript
import {
  GenQuery,
  GenQueryEngine,
  GenQueryInput,
  InjectGenQueryEngine,
} from "@generazioneai/genquery-nestjs";

@Controller("users")
export class UsersController {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectGenQueryEngine() private readonly engine: GenQueryEngine<...>,
  ) {}

  // GET /users?filter[firstName]=mario&sort=createdAt&page[perPage]=20
  @Get()
  list(
    @GenQuery({
      keys:   { searchBy: "filter", orderBy: "sort", pagination: "page" },
      allow:  ["searchBy", "orderBy", "pagination"],   // ignore select/include
      strict: true,                                    // throw 400 on unknown keys
    })
    input: GenQueryInput<User>,
  ) {
    const qb = this.users.createQueryBuilder("User");
    return this.engine.run(input, qb);   // → { data, current?, total? }
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
list(@SearchInput() input: GenQueryInput<User>) { ... }

// Per-endpoint override merges over the defaults:
@Get("export")
exportAll(@SearchInput({ allow: ["searchBy"] }) input: GenQueryInput<User>) { ... }
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

- **GET (default for read endpoints)** — REST-conventional, idempotent, cacheable, bookmarkable. Good when filters are mostly strings/enums and the query is shallow. Express's `qs` parser turns `?filter[firstName]=mario&page[page]=0` into nested objects automatically. Caveat: every value arrives as a string — for `number` / `boolean` columns add a coercion pipe (e.g. `class-transformer`'s `@Type(() => Number)`) or fall back to POST.
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

## Error handling

Parse failures throw `QueryValidationError` (re-exported from this package). The `path` field points to the offending location in the input:

```typescript
import { QueryValidationError } from "@generazioneai/genquery-nestjs";

try {
  await this.engine.run(input, qb);
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
  GenQueryModuleOptions,
  GenQueryModuleAsyncOptions,
  GenQueryFactoryOptions,
  GenQueryOptionsFactory,

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
```

## Documentation

| File | Contents |
|------|----------|
| [docs/recipes.md](docs/recipes.md) | Controller patterns, exception filter, multi-tenant engines, testing |
| [Upstream README](https://github.com/GenerazioneAI-SRL/genquery#readme) | Query language and adapter internals |
| [Upstream query reference](https://github.com/GenerazioneAI-SRL/genquery/blob/main/docs/query-reference.md) | Full `GenQueryInput` reference |

## License

[BSD 3-Clause](LICENSE)
