export { GenQueryModule } from "./genquery.module.js";
export { InjectGenQueryEngine } from "./genquery.decorators.js";
export {
  DEFAULT_GENQUERY_ENGINE_NAME,
  getGenQueryEngineToken,
} from "./genquery.tokens.js";
export {
  CANONICAL_GENQUERY_KEYS,
  mapToGenQueryInput,
  mergeGenQueryMappingOptions,
  type CanonicalGenQueryKey,
  type GenQueryKeyMapping,
  type GenQueryMappingOptions,
} from "./genquery.mapping.js";
export {
  GenQuery,
  createGenQueryDecorator,
  type GenQueryParamOptions,
} from "./genquery.param.decorator.js";
export type {
  GenQueryFactoryOptions,
  GenQueryModuleAsyncOptions,
  GenQueryModuleOptions,
  GenQueryOptionsFactory,
  CreateTypeORMEngineOptions,
} from "./genquery-options.interface.js";

// Re-export the core engine types so consumers can type their dependencies
// without a second import from the underlying package.
export {
  GenQueryEngine,
  type GenQueryEngineOptions,
  QueryValidationError,
  parseQuery,
  parseDateTime,
  type Adapter,
  type GenQueryInput,
  type ParsedQuery,
  type Schema,
  type EntityDefinition,
  type FieldDefinition,
  type FieldType,
  type RelationDefinition,
} from "@generazioneai/genquery";
