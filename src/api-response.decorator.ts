import { Type, applyDecorators } from "@nestjs/common";
import {
  ApiCreatedResponse,
  ApiExtraModels,
  ApiOkResponse,
  ApiParam,
  ApiQuery,
  getSchemaPath,
} from "@nestjs/swagger";

/**
 * Decoratori Swagger per risposte TIPIZZATE dentro l'envelope standard
 * `{ success, data, meta? }` (formato del TransformInterceptor Skillera).
 *
 * Le risposte di successo referenziano via `$ref` la classe Entity/DTO reale
 * (getSchemaPath + @ApiExtraModels auto-register). Bearer e risposte d'errore
 * NON si mettono qui: le applica il post-processor auth-driven del gateway.
 *
 * Importabile da `@generazioneai/genquery-nestjs/swagger` (richiede `@nestjs/swagger`).
 */

const paginationMeta = {
  type: "object" as const,
  properties: {
    total: { type: "number", example: 125 },
    lastPage: { type: "number", example: 7 },
    currentPage: { type: "number", example: 2 },
    perPage: { type: "number", example: 20 },
    prev: { type: "number", nullable: true, example: 1 },
    next: { type: "number", nullable: true, example: 3 },
  },
};

const dataField = (model: Type<unknown>, isArray?: boolean) =>
  isArray
    ? { type: "array" as const, items: { $ref: getSchemaPath(model) } }
    : { $ref: getSchemaPath(model) };

const envelope = (model: Type<unknown>, isArray?: boolean, withMeta?: boolean) => ({
  type: "object" as const,
  properties: {
    success: { type: "boolean", example: true },
    data: dataField(model, isArray),
    ...(withMeta ? { meta: paginationMeta } : {}),
  },
  required: ["success", "data"],
});

/** Risposta 200 con `data` = singolo oggetto tipizzato (`$ref` a `model`). */
export const ApiOkData = (
  model: Type<unknown>,
  options?: { isArray?: boolean; description?: string },
) =>
  applyDecorators(
    ApiExtraModels(model),
    ApiOkResponse({
      description: options?.description ?? "Operazione riuscita.",
      schema: envelope(model, options?.isArray),
    }),
  );

/** Risposta 201 con `data` = risorsa creata tipizzata. */
export const ApiCreatedData = (
  model: Type<unknown>,
  options?: { isArray?: boolean; description?: string },
) =>
  applyDecorators(
    ApiExtraModels(model),
    ApiCreatedResponse({
      description: options?.description ?? "Risorsa creata.",
      schema: envelope(model, options?.isArray),
    }),
  );

/** Risposta 200 paginata: `data` = array tipizzato + `meta`. */
export const ApiPaginatedData = (
  model: Type<unknown>,
  options?: { description?: string },
) =>
  applyDecorators(
    ApiExtraModels(model),
    ApiOkResponse({
      description: options?.description ?? "Elenco paginato.",
      schema: envelope(model, true, true),
    }),
  );

/** Path param UUID standard. */
export const ApiIdParam = (
  name = "id",
  description = "Identificativo UUID della risorsa.",
) =>
  applyDecorators(
    ApiParam({
      name,
      required: true,
      description,
      example: "f4f785d5-1443-41df-9f73-4fa31d3cf190",
    }),
  );

/** Query `searchBy` (envelope genquery) per gli endpoint findOne. */
export const ApiFindOneQuery = (
  resourceName: string,
  example: Record<string, unknown> = { id: "f4f785d5-1443-41df-9f73-4fa31d3cf190" },
) =>
  applyDecorators(
    ApiQuery({
      name: "searchBy",
      required: false,
      type: String,
      example: JSON.stringify(example),
      description: `Filtro JSON serializzato (searchBy) per ${resourceName}.`,
    }),
  );

/** Query genquery (searchBy/orderBy/pagination/include/select) per gli endpoint lista. */
export const ApiListQueries = (
  resourceName: string,
  searchExample: Record<string, unknown> = {},
  orderByExample: Record<string, unknown> = { field: "createdAt", order: "desc" },
) =>
  applyDecorators(
    ApiQuery({
      name: "searchBy",
      required: false,
      type: String,
      example: JSON.stringify(searchExample),
      description: `Filtro JSON serializzato (searchBy) per ${resourceName}.`,
    }),
    ApiQuery({
      name: "orderBy",
      required: false,
      type: String,
      example: JSON.stringify(orderByExample),
      description: `Ordinamento JSON serializzato (orderBy) per ${resourceName}.`,
    }),
    ApiQuery({
      name: "pagination",
      required: false,
      type: String,
      example: JSON.stringify({ page: 1, perPage: 20 }),
      description: `Paginazione JSON serializzata (envelope genquery) per ${resourceName}.`,
    }),
    ApiQuery({
      name: "include",
      required: false,
      type: String,
      example: JSON.stringify({}),
      description: `Relazioni da includere (JSON) per ${resourceName}.`,
    }),
    ApiQuery({
      name: "select",
      required: false,
      type: String,
      example: JSON.stringify({}),
      description: `Campi da selezionare (JSON) per ${resourceName}.`,
    }),
  );
