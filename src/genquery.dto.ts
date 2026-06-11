import { ApiPropertyOptional } from "@nestjs/swagger";

/**
 * Envelope GenQuery standard per le rotte lista/findOne di un gateway HTTP.
 *
 * Il FE invia i parametri genquery come JSON nei query param; il decorator
 * `@GenQuery({ from: "query" })` li parse-a in questo DTO e il controller lo
 * inoltra downstream (`{ ...genquery, auth }`), dove `mapToGenQueryInput` lo
 * traduce in `GenQueryInput`. Volutamente permissivo: la validazione/allowlist
 * dei singoli campi è demandata all'engine genquery a valle (policy per-modello).
 *
 * Importabile da `@generazioneai/genquery-nestjs/swagger` (richiede `@nestjs/swagger`).
 */
export class GenQueryDto {
  @ApiPropertyOptional({
    type: "object",
    additionalProperties: true,
    description: "Filtri di dominio (tradotti in Prisma where da genquery).",
  })
  searchBy?: Record<string, any>;

  @ApiPropertyOptional({
    type: "object",
    additionalProperties: true,
    description: 'Ordinamento, es. { field: "createdAt", order: "desc" }.',
  })
  orderBy?: Record<string, any>;

  @ApiPropertyOptional({
    type: "object",
    additionalProperties: true,
    description: "Relazioni/campi da includere (Prisma include).",
  })
  include?: Record<string, any>;

  @ApiPropertyOptional({
    type: "object",
    additionalProperties: true,
    description: "Proiezione campi (Prisma select).",
  })
  select?: Record<string, any>;

  @ApiPropertyOptional({
    description:
      'Paginazione: { page, perPage } (page 0-based) oppure "all" / "first".',
  })
  pagination?: Record<string, any> | string;
}
