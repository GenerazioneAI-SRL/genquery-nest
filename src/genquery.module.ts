import { DynamicModule, Module, Provider, Type } from "@nestjs/common";
import { getDataSourceToken } from "@nestjs/typeorm";
import { createTypeORMEngine } from "@generazioneai/genquery/typeorm";
import type { DataSource } from "typeorm";
import { getGenQueryEngineToken } from "./genquery.tokens.js";
import type {
  GenQueryFactoryOptions,
  GenQueryModuleAsyncOptions,
  GenQueryModuleOptions,
  GenQueryOptionsFactory,
} from "./genquery-options.interface.js";

const GENQUERY_FACTORY_OPTIONS = "GENQUERY_FACTORY_OPTIONS";

/**
 * NestJS module that exposes a `GenQueryEngine` built on the TypeORM adapter.
 *
 *   @Module({
 *     imports: [
 *       TypeOrmModule.forRoot({ ... entities: [User, Post] }),
 *       GenQueryModule.forRoot(),
 *     ],
 *   })
 *   export class AppModule {}
 *
 *   // Inside a service:
 *   constructor(
 *     @InjectGenQueryEngine() private readonly engine: GenQueryEngine<...>,
 *   ) {}
 *
 * The default DataSource is resolved via `getDataSourceToken()`. For a non-
 * default TypeORM connection pass `dataSource: "<name>"`. To register more
 * than one engine, pass distinct `name` values.
 */
@Module({})
export class GenQueryModule {
  /**
   * Synchronous registration. Use this when the schema / adapter options are
   * known at module-construction time.
   */
  static forRoot(options: GenQueryModuleOptions = {}): DynamicModule {
    const { name, dataSource, ...factoryOptions } = options;
    const engineToken = getGenQueryEngineToken(name);
    const dataSourceToken = dataSource ?? getDataSourceToken();

    const engineProvider: Provider = {
      provide: engineToken,
      useFactory: (ds: DataSource) => createTypeORMEngine(ds, factoryOptions),
      inject: [dataSourceToken],
    };

    return {
      module: GenQueryModule,
      providers: [engineProvider],
      exports: [engineProvider],
    };
  }

  /**
   * Async registration via `useFactory` / `useClass` / `useExisting`. Use this
   * when options depend on injected services (e.g. config service).
   */
  static forRootAsync(options: GenQueryModuleAsyncOptions): DynamicModule {
    const engineToken = getGenQueryEngineToken(options.name);
    const dataSourceToken = options.dataSource ?? getDataSourceToken();

    const optionsProviders = this.createAsyncOptionsProviders(options);

    const engineProvider: Provider = {
      provide: engineToken,
      useFactory: (factoryOptions: GenQueryFactoryOptions, ds: DataSource) =>
        createTypeORMEngine(ds, factoryOptions),
      inject: [GENQUERY_FACTORY_OPTIONS, dataSourceToken],
    };

    return {
      module: GenQueryModule,
      imports: options.imports ?? [],
      providers: [...optionsProviders, engineProvider],
      exports: [engineProvider],
    };
  }

  private static createAsyncOptionsProviders(
    options: GenQueryModuleAsyncOptions,
  ): Provider[] {
    if (options.useFactory) {
      return [
        {
          provide: GENQUERY_FACTORY_OPTIONS,
          useFactory: options.useFactory,
          inject: options.inject ?? [],
        },
      ];
    }

    if (options.useExisting) {
      return [
        {
          provide: GENQUERY_FACTORY_OPTIONS,
          useFactory: (factory: GenQueryOptionsFactory) =>
            factory.createGenQueryOptions(),
          inject: [options.useExisting],
        },
      ];
    }

    if (options.useClass) {
      const useClass = options.useClass as Type<GenQueryOptionsFactory>;
      return [
        {
          provide: GENQUERY_FACTORY_OPTIONS,
          useFactory: (factory: GenQueryOptionsFactory) =>
            factory.createGenQueryOptions(),
          inject: [useClass],
        },
        {
          provide: useClass,
          useClass,
        },
      ];
    }

    throw new Error(
      "GenQueryModule.forRootAsync requires one of: useFactory, useClass, useExisting.",
    );
  }
}
