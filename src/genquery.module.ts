import { DynamicModule, Module, Provider, Type } from "@nestjs/common";
import { createPrismaEngine } from "@generazioneai/genquery/prisma";
import { buildGenQueryPolicy } from "@generazioneai/genquery";
import { getGenQueryEngineToken } from "./genquery.tokens.js";
import type {
  GenQueryPrismaFactoryOptions,
  GenQueryPrismaModuleAsyncOptions,
  GenQueryPrismaModuleOptions,
  GenQueryPrismaOptionsFactory,
} from "./genquery-prisma-options.interface.js";

const GENQUERY_PRISMA_FACTORY_OPTIONS = "GENQUERY_PRISMA_FACTORY_OPTIONS";

/**
 * NestJS module that exposes a Prisma-backed `GenQueryEngine` as an injectable
 * provider.
 *
 *   @Module({
 *     imports: [
 *       GenQueryModule.forPrismaRoot({
 *         prisma: PrismaService,
 *         datamodel: datamodel,
 *         schema: { models: ["User", "Post"] },
 *       }),
 *     ],
 *   })
 *   export class AppModule {}
 *
 *   // Inside a service:
 *   constructor(
 *     @InjectGenQueryEngine() private readonly engine: GenQueryEngine<...>,
 *   ) {}
 *
 * To register more than one engine pass distinct `name` values.
 */
@Module({})
export class GenQueryModule {
  /**
   * Synchronous Prisma registration.
   *
   *   GenQueryModule.forPrismaRoot({
   *     prisma: PrismaService,
   *     datamodel: datamodel,
   *     schema: { models: ["User", "Post"] },
   *   });
   *
   * `prisma` is the DI token that resolves to your `PrismaClient` /
   * `PrismaService` instance.
   */
  static forPrismaRoot(options: GenQueryPrismaModuleOptions): DynamicModule {
    const { name, prisma, model, global, ...factoryOptions } = options;
    const engineToken = getGenQueryEngineToken(name);

    const engineProvider: Provider = {
      provide: engineToken,
      useFactory: (client: Record<string, unknown>) =>
        buildPrismaEngine(client, factoryOptions, model),
      inject: [prisma],
    };

    return {
      module: GenQueryModule,
      global: global ?? false,
      providers: [engineProvider],
      exports: [engineProvider],
    };
  }

  /**
   * Async Prisma registration via `useFactory` / `useClass` / `useExisting`.
   *
   *   GenQueryModule.forPrismaRootAsync({
   *     prisma: PrismaService,
   *     useFactory: () => ({ datamodel: datamodel }),
   *   });
   */
  static forPrismaRootAsync(
    options: GenQueryPrismaModuleAsyncOptions,
  ): DynamicModule {
    const engineToken = getGenQueryEngineToken(options.name);
    const { prisma, model } = options;

    const optionsProviders = this.createPrismaAsyncOptionsProviders(options);

    const engineProvider: Provider = {
      provide: engineToken,
      useFactory: (
        factoryOptions: GenQueryPrismaFactoryOptions,
        client: Record<string, unknown>,
      ) => buildPrismaEngine(client, factoryOptions, model),
      inject: [GENQUERY_PRISMA_FACTORY_OPTIONS, prisma],
    };

    return {
      module: GenQueryModule,
      global: options.global ?? false,
      imports: options.imports ?? [],
      providers: [...optionsProviders, engineProvider],
      exports: [engineProvider],
    };
  }

  private static createPrismaAsyncOptionsProviders(
    options: GenQueryPrismaModuleAsyncOptions,
  ): Provider[] {
    if (options.useFactory) {
      return [
        {
          provide: GENQUERY_PRISMA_FACTORY_OPTIONS,
          useFactory: options.useFactory,
          inject: options.inject ?? [],
        },
      ];
    }

    if (options.useExisting) {
      return [
        {
          provide: GENQUERY_PRISMA_FACTORY_OPTIONS,
          useFactory: (factory: GenQueryPrismaOptionsFactory) =>
            factory.createGenQueryPrismaOptions(),
          inject: [options.useExisting],
        },
      ];
    }

    if (options.useClass) {
      const useClass = options.useClass as Type<GenQueryPrismaOptionsFactory>;
      return [
        {
          provide: GENQUERY_PRISMA_FACTORY_OPTIONS,
          useFactory: (factory: GenQueryPrismaOptionsFactory) =>
            factory.createGenQueryPrismaOptions(),
          inject: [useClass],
        },
        {
          provide: useClass,
          useClass,
        },
      ];
    }

    throw new Error(
      "GenQueryModule.forPrismaRootAsync requires one of: useFactory, useClass, useExisting.",
    );
  }
}

/**
 * Build a Prisma-backed engine from a resolved Prisma client. Validates that
 * the named model exists on the client when `model` is set — early-fail so
 * the caller doesn't get a cryptic `cannot read property 'findMany' of
 * undefined` at query time.
 */
function buildPrismaEngine(
  client: Record<string, unknown>,
  factoryOptions: GenQueryPrismaFactoryOptions,
  model: string | undefined,
) {
  const { datamodel, schema, adapter, policy } = factoryOptions;
  let effectiveSchema = schema;
  if (policy) {
    // Build the DENY-based EntityPolicy from the manifests over the same datamodel.
    // An explicit `schema.policy` entry wins over the auto-built one (override hook).
    const built = buildGenQueryPolicy({
      datamodel,
      manifests: policy.resources,
      deny: policy.deny,
      extraSecretFields: policy.extraSecretFields,
    });
    effectiveSchema = {
      ...(schema ?? {}),
      policy: { ...built, ...(schema?.policy ?? {}) },
    };
  }
  const engine = createPrismaEngine(datamodel, { schema: effectiveSchema, adapter });
  if (model !== undefined && !(model in client)) {
    throw new Error(
      `GenQueryModule: Prisma client has no delegate for model '${model}'. ` +
        "Check that the name matches the field on your PrismaClient (camelCased model name).",
    );
  }
  return engine;
}
