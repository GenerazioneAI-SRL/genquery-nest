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
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectGenQueryEngine()
    private readonly engine: GenQueryEngine<
      SelectQueryBuilder<ObjectLiteral>,
      SelectQueryBuilder<ObjectLiteral>
    >,
  ) {}

  search(input: GenQueryInput<User>): Promise<User[]> {
    const qb = this.users.createQueryBuilder("User");
    return this.engine.run(input, qb).getMany();
  }

  searchWithCount(input: GenQueryInput<User>): Promise<[User[], number]> {
    const qb = this.users.createQueryBuilder("User");
    return this.engine.run(input, qb).getManyAndCount();
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
  async list(@GenQuery() input: GenQueryInput<User>) {
    const [items, total] = await this.users.searchWithCount(input);
    return { items, total };
  }
}
```

`@GenQuery()` reads the request query for `GET`/`HEAD` and the body for any other method — same decorator, same handler signature. The `GenQueryInput<User>` type-parameter gives autocomplete and value-shape checking against the entity's fields and relations.

For large or deeply nested queries (heavy use of OR, several relation filters, mixed types) prefer POST — URL length limits and access logs make GET awkward:

```typescript
@Post("search")
@HttpCode(200)
async search(@GenQuery() input: GenQueryInput<User>) {
  const [items, total] = await this.users.searchWithCount(input);
  return { items, total };
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
  input: GenQueryInput<User>,
) {
  const qb = this.users.createQueryBuilder("User");
  return this.engine.run(input, qb).getMany();
}
```

A read-only public endpoint that locks down everything except `filter`:

```typescript
// GET /users/public?filter[firstName]=mario
@Get("public")
publicList(
  @GenQuery({ keys: { searchBy: "filter" }, allow: ["searchBy"], strict: true })
  input: GenQueryInput<User>,
) {
  const qb = this.users.createQueryBuilder("User")
    .take(50);                              // app-imposed page size
  return this.engine.run(input, qb).getMany();
}
```

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
list(@SearchInput() input: GenQueryInput<User>) { /* ... */ }

// override on one endpoint
@Get("internal")
internalList(@SearchInput({ allow: ["searchBy", "orderBy", "select", "include", "pagination"] })
  input: GenQueryInput<User>) { /* ... */ }
```

### Forcing a source

`from: "auto"` (the default) reads `request.query` on `GET`/`HEAD` and `request.body` everywhere else. Override only when you need to break that convention:

```typescript
// Body of a GET request (uncommon, but supported by some frameworks):
@Get()
list(@GenQuery({ from: "body" }) input: GenQueryInput<User>) { /* ... */ }

// Read the URL of a POST (e.g. POST /search?paginate=true mixed with a JSON body
// you process elsewhere):
@Post("search")
search(@GenQuery({ from: "query" }) input: GenQueryInput<User>) { /* ... */ }
```

Express's default `qs` parser turns `?filter[firstName]=mario&page[page]=0` into nested objects ready to consume. Flat params like `?page=0&perPage=20` need a small Pipe to reshape — the decorator only renames top-level keys. Note also that every query-string value is a string, so `number` / `boolean` filters need explicit coercion (a `ValidationPipe` with `transform: true` is the usual fix).

## Pre-parsing for caching

For hot endpoints you can parse once and replay the result against many queries:

```typescript
const parsed = this.engine.parse<User>(input, "User"); // cacheable
const qb = this.users.createQueryBuilder("User");
return this.engine.runParsed(parsed, qb).getMany();
```

The parsed form is plain data — safe to JSON-serialize into Redis or an in-memory LRU.

## Per-tenant engines

Different schema overrides per tenant via two registrations:

```typescript
@Module({
  imports: [
    TypeOrmModule.forRoot({ /* ... */ }),
    GenQueryModule.forRoot({ name: "public" }),
    GenQueryModule.forRoot({
      name: "admin",
      schema:  { overrides: { User: { internalNotes: "string" } } },
      adapter: { paramPrefix: "a" },
    }),
  ],
})
export class AppModule {}
```

```typescript
constructor(
  @InjectGenQueryEngine("public") private readonly publicEngine: GenQueryEngine<...>,
  @InjectGenQueryEngine("admin")  private readonly adminEngine:  GenQueryEngine<...>,
) {}

search(input: GenQueryInput<User>, isAdmin: boolean) {
  const engine = isAdmin ? this.adminEngine : this.publicEngine;
  const qb = this.users.createQueryBuilder("User");
  return engine.run(input, qb).getMany();
}
```

## Multiple TypeORM connections

```typescript
@Module({
  imports: [
    TypeOrmModule.forRoot({ /* default */ }),
    TypeOrmModule.forRoot({ name: "reports", /* ... */ }),

    GenQueryModule.forRoot(),                            // default DataSource
    GenQueryModule.forRoot({
      name: "reports",
      dataSource: "reports",                             // → getDataSourceToken("reports")
    }),
  ],
})
export class AppModule {}
```

## Testing

The engine has no side effects of its own, but it needs an initialized DataSource. With SQLite-in-memory you get a fast end-to-end test:

```typescript
// users.service.spec.ts
import { Test } from "@nestjs/testing";
import { TypeOrmModule } from "@nestjs/typeorm";
import { GenQueryModule } from "@generazioneai/genquery-nestjs";

describe("UsersService", () => {
  let svc: UsersService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: "sqlite",
          database: ":memory:",
          entities: [User],
          synchronize: true,
        }),
        TypeOrmModule.forFeature([User]),
        GenQueryModule.forRoot(),
      ],
      providers: [UsersService],
    }).compile();

    svc = moduleRef.get(UsersService);
  });

  it("filters by string field", async () => {
    const result = await svc.search({
      searchBy: { firstName: "mario" },
      pagination: { page: 0, perPage: 20 },
    });
    expect(result).toBeDefined();
  });
});
```

For unit tests that don't need a real DB, build a fake engine and override the provider:

```typescript
const fakeEngine = {
  run: jest.fn().mockReturnValue({ getMany: () => Promise.resolve([]) }),
};

const moduleRef = await Test.createTestingModule({
  providers: [
    UsersService,
    { provide: getGenQueryEngineToken(), useValue: fakeEngine },
    { provide: getRepositoryToken(User), useValue: { createQueryBuilder: jest.fn() } },
  ],
}).compile();
```

## Manual provider (skip the module)

If you need maximum control — e.g. building a custom adapter or sharing the engine across feature modules — register the provider yourself:

```typescript
import { createTypeORMEngine } from "@generazioneai/genquery/typeorm";
import { getDataSourceToken } from "@nestjs/typeorm";
import { getGenQueryEngineToken } from "@generazioneai/genquery-nestjs";
import type { DataSource } from "typeorm";

@Module({
  providers: [
    {
      provide: getGenQueryEngineToken(),
      useFactory: (ds: DataSource) => createTypeORMEngine(ds, {
        schema:  { /* ... */ },
        adapter: { /* ... */ },
      }),
      inject: [getDataSourceToken()],
    },
  ],
  exports: [getGenQueryEngineToken()],
})
export class GenQueryFeatureModule {}
```

The decorator and token helpers work the same way whether the engine was registered via `GenQueryModule` or by hand.
