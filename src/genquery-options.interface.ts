import type { ModuleMetadata, Type } from "@nestjs/common";
import type {
  CreateTypeORMEngineOptions,
  SchemaFromTypeORMOptions,
  TypeORMAdapterOptions,
} from "@generazioneai/genquery/typeorm";

/**
 * The shape that `useFactory` (and similar async providers) must return.
 * Mirrors `CreateTypeORMEngineOptions` from the underlying package.
 */
export interface GenQueryFactoryOptions {
  schema?: SchemaFromTypeORMOptions;
  adapter?: TypeORMAdapterOptions;
}

/**
 * Synchronous options accepted by `GenQueryModule.forRoot(...)`.
 *
 *  - `name`       — register a named engine (default: `"default"`).
 *  - `dataSource` — DI token of the TypeORM `DataSource` to use. Defaults to
 *                   the unnamed `DataSource` registered by `@nestjs/typeorm`
 *                   (i.e. `getDataSourceToken()`). Pass a string when you
 *                   registered TypeORM with a non-default name.
 *  - `schema`     — forwarded to `schemaFromTypeORM`.
 *  - `adapter`    — forwarded to the `TypeORMAdapter` constructor.
 */
export interface GenQueryModuleOptions extends GenQueryFactoryOptions {
  name?: string;
  dataSource?: string | symbol | Function;
}

/**
 * Async options for `GenQueryModule.forRootAsync(...)`. Follows the standard
 * NestJS dynamic-module pattern with `useFactory` / `useClass` / `useExisting`.
 */
export interface GenQueryModuleAsyncOptions
  extends Pick<ModuleMetadata, "imports"> {
  name?: string;
  dataSource?: string | symbol | Function;
  useExisting?: Type<GenQueryOptionsFactory>;
  useClass?: Type<GenQueryOptionsFactory>;
  useFactory?: (
    ...args: any[]
  ) => Promise<GenQueryFactoryOptions> | GenQueryFactoryOptions;
  inject?: any[];
}

/**
 * Implement this on a class passed to `useClass` / `useExisting`.
 */
export interface GenQueryOptionsFactory {
  createGenQueryOptions():
    | Promise<GenQueryFactoryOptions>
    | GenQueryFactoryOptions;
}

/**
 * Re-export of the underlying engine options for advanced consumers
 * (e.g. building a provider by hand).
 */
export type { CreateTypeORMEngineOptions };
