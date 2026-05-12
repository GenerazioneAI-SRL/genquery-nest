# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this package is

`@generazioneai/genquery-nestjs` — a NestJS dynamic module that wraps `@generazioneai/genquery` and exposes its TypeORM-backed `GenQueryEngine` as an injectable provider. The core query/parser/adapter logic lives in the sibling package, not here; this repo only contains the Nest glue.

Sibling source available locally at `/Users/massimiliano/Projects/genquery/src` — read it directly when extending the adapter surface or debugging engine behavior.

## Commands

- `npm install` — install deps
- `npm run build` — `tsc` → emits to `dist/`
- `npm run typecheck` — `tsc --noEmit`
- `npm run prepublishOnly` — runs build before `npm publish`

No tests, linter, or formatter are wired up.

## Architecture

Five small layers, plus a public barrel:

1. **Token plumbing** (`src/genquery.tokens.ts`) — `getGenQueryEngineToken(name?)` derives the DI token string. Multiple named engines coexist by passing distinct `name` values; default name is `"default"`.
2. **Injection decorator** (`src/genquery.decorators.ts`) — `@InjectGenQueryEngine(name?)` is a thin alias for `Inject(getGenQueryEngineToken(name))`.
3. **Module** (`src/genquery.module.ts`) — `GenQueryModule.forRoot()` / `forRootAsync()` build a provider whose factory calls `createTypeORMEngine(dataSource, { schema, adapter })` from `@generazioneai/genquery/typeorm`.
4. **Wire-key mapping** (`src/genquery.mapping.ts`) — `mapToGenQueryInput(raw, options)` is a pure function that renames external top-level keys (e.g. `filter` → `searchBy`) and drops/rejects keys outside an allowlist. Stateless, no DI.
5. **Request decorator** (`src/genquery.param.decorator.ts`) — `@GenQuery()` reads `request.body` or `request.query` and pipes it through `mapToGenQueryInput`. `createGenQueryDecorator(defaults)` returns a project-specific decorator with options baked in; call-site overrides shallow-merge over the defaults.

The DataSource is resolved through `@nestjs/typeorm`'s `getDataSourceToken()` by default. Pass `dataSource: "<name>"` to bind to a non-default TypeORM connection.

`forRootAsync` deliberately separates two kinds of options:
- `name` and `dataSource` live on the top-level `forRootAsync(options)` call because they determine the DI token, which must be known synchronously when the module is registered.
- `schema` and `adapter` flow through `useFactory` / `useClass` / `useExisting` and may depend on injected services (e.g. a config service).

`src/index.ts` re-exports the core engine surface (`GenQueryEngine`, `QueryValidationError`, `Schema`, etc.) from `@generazioneai/genquery` so consumers don't need a second import.

## Build configuration — non-obvious constraints

- `tsconfig.json` uses `"module": "node16"` and `"moduleResolution": "node16"`. This is **required** because we import `@generazioneai/genquery/typeorm`, which is a subpath defined only in the upstream package's `exports` map. Classic `node` resolution ignores `exports` and breaks the import. Do not downgrade these.
- Relative imports in `src/` use explicit `.js` extensions (e.g. `from "./genquery.tokens.js"`). `node16` resolution requires this for ESM-style spec compliance even when emitting CommonJS.
- `package.json` has **no** `"type": "module"` field. With `module: node16` + no `"type"`, `tsc` emits CommonJS. Adding `"type": "module"` would flip the package to ESM and break CJS consumers — don't add it without an intentional ESM migration.

## Peer dependencies

`@generazioneai/genquery`, `@nestjs/common`, `@nestjs/core`, `@nestjs/typeorm`, `typeorm`, `reflect-metadata`, `rxjs` — all declared as peers. Consumers bring their own versions; the lib only pins them as devDependencies for build/typecheck.
