import type { ModuleMetadata, Type } from "@nestjs/common";
import type {
  CreatePrismaEngineOptions,
  PrismaAdapterOptions,
  PrismaDatamodel,
  SchemaFromPrismaOptions,
} from "@generazioneai/genquery/prisma";

/**
 * Shape that `useFactory` (and similar async providers) must return for the
 * Prisma engine. Mirrors `CreatePrismaEngineOptions` from the underlying
 * package, plus the `datamodel` which the engine needs to derive the schema.
 *
 * `datamodel` is required here because it carries the field/type info that
 * `schemaFromPrisma` consumes. Pass `Prisma.dmmf.datamodel` from your project,
 * or any structurally-equivalent value.
 */
export interface GenQueryPrismaFactoryOptions {
  datamodel: PrismaDatamodel;
  schema?: SchemaFromPrismaOptions;
  adapter?: PrismaAdapterOptions;
}

/**
 * Synchronous options for `GenQueryModule.forPrismaRoot(...)`.
 *
 *  - `name`     — register a named engine (default: `"default"`).
 *  - `prisma`   — DI token of the Prisma client. Required: pass the token
 *                 your app uses for `PrismaClient` / `PrismaService`.
 *  - `model`    — name of the field on the Prisma client that maps to the
 *                 model delegate the engine binds to (e.g. `"user"` →
 *                 `prismaClient.user`). When set, the engine resolves the
 *                 delegate at construction. Optional — leave unset to call
 *                 `engine.run(input, "User", prisma.user)` from your code.
 *  - `datamodel`/`schema`/`adapter` — forwarded to `createPrismaEngine`.
 */
export interface GenQueryPrismaModuleOptions
  extends GenQueryPrismaFactoryOptions {
  name?: string;
  prisma: string | symbol | Function | Type<unknown>;
  model?: string;
  /**
   * Register the dynamic module as global so the engine is injectable from
   * any feature module without re-importing `GenQueryModule`. Mirrors
   * `ConfigModule`'s `isGlobal` switch. Defaults to `false`.
   */
  global?: boolean;
}

/**
 * Async options for `GenQueryModule.forPrismaRootAsync(...)`. Standard NestJS
 * dynamic-module pattern with `useFactory` / `useClass` / `useExisting`.
 */
export interface GenQueryPrismaModuleAsyncOptions
  extends Pick<ModuleMetadata, "imports"> {
  name?: string;
  prisma: string | symbol | Function | Type<unknown>;
  model?: string;
  global?: boolean;
  useExisting?: Type<GenQueryPrismaOptionsFactory>;
  useClass?: Type<GenQueryPrismaOptionsFactory>;
  useFactory?: (
    ...args: any[]
  ) => Promise<GenQueryPrismaFactoryOptions> | GenQueryPrismaFactoryOptions;
  inject?: any[];
}

/**
 * Implement on a class passed to `useClass` / `useExisting`.
 */
export interface GenQueryPrismaOptionsFactory {
  createGenQueryPrismaOptions():
    | Promise<GenQueryPrismaFactoryOptions>
    | GenQueryPrismaFactoryOptions;
}

export type { CreatePrismaEngineOptions };
