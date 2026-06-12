# Recipes

Common patterns when using `@generazioneai/genquery-nestjs`. The query language itself is documented in the [upstream package](https://github.com/GenerazioneAI-SRL/genquery#documentation); this page covers Nest-specific integration.

## Exception filter

`QueryValidationError` carries a `path` pointing at the offending location inside the input. A small filter turns it into a 400 response with a useful body:

```typescript
// genquery-validation.filter.ts
import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
} from "@nestjs/common";
import { QueryValidationError } from "@generazioneai/genquery-nestjs";

@Catch(QueryValidationError)
export class GenQueryValidationFilter implements ExceptionFilter {
  catch(error: QueryValidationError, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse();
    const body = new BadRequestException({
      statusCode: 400,
      error: "Bad Request",
      message: error.message,
      path: error.path,
    }).getResponse();
    response.status(400).json(body);
  }
}
```

Register globally:

```typescript
const app = await NestFactory.create(AppModule);
app.useGlobalFilters(new GenQueryValidationFilter());
```

## Controller + service split

The engine is a stateless adapter — keep it in the service layer and let the controller stay thin.

```typescript
// users.service.ts
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectGenQueryEngine()
    private readonly engine: GenQueryEngine<any, any>,
  ) {}

  // `engine.run` executes the query and resolves to a `PaginatedResult<User>`:
  //   { data: User[], current?: number, total?: number }
  // `current` / `total` are present iff the input asked for them via
  // `pagination.showNumber` / `pagination.showTotal` (both default to `true`).
  // The root entity name is passed explicitly — Prisma delegates don't expose it.
  search(input: GenQueryInput): Promise<PaginatedResult<User>> {
    return this.engine.run(input, "User", this.prisma.user);
  }

  // Opt out of the count when you only need the rows:
  async listOnly(input: GenQueryInput): Promise<User[]> {
    const { data } = await this.engine.run(
      { ...input, pagination: { ...(input.pagination as object), showTotal: false } },
      "User",
      this.prisma.user,
    );
    return data;
  }
}
```

```typescript
// users.controller.ts
@Controller("users")
export class UsersController {
  constructor(private readonly users: UsersService) {}

  // GET /users?searchBy[firstName]=mario&orderBy=createdAt&pagination[perPage]=20
  @Get()
  list(@GenQuery() input: GenQueryInput) {
    return this.users.search(input);  // { data, current, total }
  }
}
```

`@GenQuery()` reads the request query for `GET`/`HEAD` and the body for any other method — same decorator, same handler signature.

For large or deeply nested queries (heavy use of OR, several relation filters, mixed types) prefer POST — URL length limits and access logs make GET awkward:

```typescript
@Post("search")
@HttpCode(200)
search(@GenQuery() input: GenQueryInput) {
  return this.users.search(input);    // { data, current, total }
}
```

## Renaming wire keys per endpoint

When a public API uses different names than `GenQueryInput`'s canonical keys (`filter` vs `searchBy`, `sort` vs `orderBy`, …), or only exposes some of them, use `@GenQuery()` to translate at the boundary:

```typescript
// GET /users?filter[firstName]=mario&sort=createdAt&page[perPage]=20
@Get()
list(
  @GenQuery({
    keys:   { searchBy: "filter", orderBy: "sort", pagination: "page" },
    allow:  ["searchBy", "orderBy", "pagination"],   // hide select / include
    strict: true,                                    // 400 on unknown keys
  })
  input: GenQueryInput,
) {
  return this.users.search(input);    // { data, current?, total? }
}
```

A read-only public endpoint that locks down everything except `filter`:

```typescript
// GET /users/public?filter[firstName]=mario
@Get("public")
publicList(
  @GenQuery({ keys: { searchBy: "filter" }, allow: ["searchBy"], strict: true })
  input: GenQueryInput,
) {
  // app-imposed page size: the input can't override it (pagination isn't allowed)
  return this.users.search({ ...input, pagination: { page: 0, perPage: 50 } });
}
```

For server-enforced caps across the whole model surface, prefer a schema `policy` (`maxPerPage` is clamped by the parser — see the [policy section](../README.md#policy-from-resource-manifests)).

For app-wide defaults, build a custom decorator once and reuse it:

```typescript
// shared/search-input.decorator.ts
export const SearchInput = createGenQueryDecorator({
  keys:   { searchBy: "filter", orderBy: "sort", pagination: "page" },
  allow:  ["searchBy", "orderBy", "pagination"],
  strict: true,
});

// any controller
@Get()
list(@SearchInput() input: GenQueryInput) { /* ... */ }

// override on one endpoint
@Get("internal")
internalList(@SearchInput({ allow: ["searchBy", "orderBy", "select", "include", "pagination"] })
  input: GenQueryInput) { /* ... */ }
```

### JSON strings in the query

By default, `@GenQuery()` parses each canonical key's value as JSON when it arrives as a string starting with `{` or `[`. Two equivalent requests:

```
GET /users?searchBy={"firstName":"ada","posts":{"title":"typescript"}}&pagination={"page":0,"perPage":20}
GET /users?searchBy[firstName]=ada&searchBy[posts][title]=typescript&pagination[page]=0&pagination[perPage]=20
```

Pick whichever fits your clients — they yield the same `GenQueryInput` after the decorator runs. The JSON form keeps native types (`true`, `42`, `null`) intact; the bracket form passes everything as strings and needs a coercion pipe for `number` / `boolean` columns.

Tune with `parseJson`:

```typescript
@Get()
list(@GenQuery({ parseJson: true })  input: GenQueryInput) {}   // require JSON
@Get()
list(@GenQuery({ parseJson: false }) input: GenQueryInput) {}   // never parse
```

`true` makes invalid JSON a 400. `"auto"` (default) only parses values that look like JSON, leaving bare-string shorthands (`orderBy=createdAt`, `pagination=all`) alone.

### Forcing a source

`from: "auto"` (the default) reads `request.query` on `GET`/`HEAD` and `request.body` everywhere else. Override only when you need to break that convention:

```typescript
// Body of a GET request (uncommon, but supported by some frameworks):
@Get()
list(@GenQuery({ from: "body" }) input: GenQueryInput) { /* ... */ }

// Read the URL of a POST (e.g. POST /search?paginate=true mixed with a JSON body
// you process elsewhere):
@Post("search")
search(@GenQuery({ from: "query" }) input: GenQueryInput) { /* ... */ }
```

Express's default `qs` parser turns `?filter[firstName]=mario&page[page]=0` into nested objects ready to consume. Flat params like `?page=0&perPage=20` need a small Pipe to reshape — the decorator only renames top-level keys. Note also that every query-string value is a string, so `number` / `boolean` filters need explicit coercion (whole-JSON values per key are the usual fix).

## Pre-parsing for caching

For hot endpoints you can parse once and replay the result against many queries:

```typescript
const parsed = this.engine.parse(input, "User");                 // cacheable
const args   = this.engine.runParsed(parsed, this.prisma.user);  // { where, orderBy, skip, take, ... }
const rows   = await this.prisma.user.findMany(args);
```

The parsed form is plain data — safe to JSON-serialize into Redis or an in-memory LRU. `runParsed` is sync and returns the Prisma args object without executing — call `findMany` / `count` yourself. Use this when you want to skip `engine.run`'s built-in execution and shape the output yourself (custom chaining, transactions, raw SQL around it).

## Per-audience engines

Different schema restrictions per audience via two registrations over the same Prisma client:

```typescript
@Module({
  imports: [
    GenQueryModule.forPrismaRoot({
      name: "public",
      prisma: PrismaService,
      datamodel: Prisma.dmmf.datamodel,
      schema: { models: ["User", "Post"] },          // narrow surface
    }),
    GenQueryModule.forPrismaRoot({
      name: "admin",
      prisma: PrismaService,
      datamodel: Prisma.dmmf.datamodel,
      schema: { overrides: { User: { internalNotes: "string" } } },
    }),
  ],
})
export class AppModule {}
```

```typescript
constructor(
  private readonly prisma: PrismaService,
  @InjectGenQueryEngine("public") private readonly publicEngine: GenQueryEngine<any, any>,
  @InjectGenQueryEngine("admin")  private readonly adminEngine:  GenQueryEngine<any, any>,
) {}

search(input: GenQueryInput, isAdmin: boolean) {
  const engine = isAdmin ? this.adminEngine : this.publicEngine;
  return engine.run(input, "User", this.prisma.user);   // { data, current?, total? }
}
```

For field/relation allowlists (filterable / sortable / includable, `maxPerPage` caps) prefer a single engine with a schema `policy` — see the [README](../README.md#policy-from-resource-manifests).

## Multiple Prisma clients

If your app talks to more than one database through distinct Prisma clients, register an engine per client token:

```typescript
@Module({
  imports: [
    GenQueryModule.forPrismaRoot({
      prisma: PrismaService,                             // default DB
      datamodel: Prisma.dmmf.datamodel,
    }),
    GenQueryModule.forPrismaRoot({
      name: "reports",
      prisma: ReportsPrismaService,                      // second client
      datamodel: ReportsPrisma.dmmf.datamodel,
    }),
  ],
})
export class AppModule {}
```

## Testing

The engine itself is side-effect free until `run` executes against a delegate. For unit tests that don't need a real DB, build a fake engine and override the provider:

```typescript
const fakeEngine = {
  run: jest.fn().mockResolvedValue({ data: [], current: 0, total: 0 }),
};

const moduleRef = await Test.createTestingModule({
  providers: [
    UsersService,
    { provide: getGenQueryEngineToken(), useValue: fakeEngine },
    { provide: PrismaService, useValue: { user: { findMany: jest.fn() } } },
  ],
}).compile();
```

For integration tests, register the module against a test database (the datamodel comes from your generated client either way):

```typescript
const moduleRef = await Test.createTestingModule({
  imports: [
    GenQueryModule.forPrismaRoot({
      prisma: PrismaService,
      datamodel: Prisma.dmmf.datamodel,
    }),
  ],
  providers: [PrismaService, UsersService],
}).compile();

const svc = moduleRef.get(UsersService);
const { data, total } = await svc.search({
  searchBy: { firstName: "mario" },
  pagination: { page: 0, perPage: 20 },
});
```

Queries that should never hit the DB can be asserted at the args level via `parse` + `runParsed` — no client needed:

```typescript
const engine = moduleRef.get(getGenQueryEngineToken());
const args = engine.runParsed(engine.parse({ searchBy: { firstName: "mario" } }, "User"), prisma.user);
expect(args.where).toEqual({ firstName: { contains: "mario", mode: "insensitive" } });
```

## Manual provider (skip the module)

If you need maximum control — e.g. wiring a custom adapter or sharing the engine across feature modules — register the provider yourself:

```typescript
import { createPrismaEngine } from "@generazioneai/genquery/prisma";
import { Prisma } from "@prisma/client";
import { getGenQueryEngineToken } from "@generazioneai/genquery-nestjs";
import { PrismaService } from "./prisma.service";

@Module({
  providers: [
    {
      provide: getGenQueryEngineToken(),
      useFactory: () => createPrismaEngine(Prisma.dmmf.datamodel, {
        schema:  { /* ... */ },
        adapter: { /* ... */ },
      }),
    },
  ],
  exports: [getGenQueryEngineToken()],
})
export class GenQueryFeatureModule {}
```

The decorator and token helpers work the same way whether the engine was registered via `GenQueryModule` or by hand.
