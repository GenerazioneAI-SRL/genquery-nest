// @generazioneai/genquery-nestjs/swagger — helper Swagger per gateway HTTP.
// Subpath separato perché tira @nestjs/swagger: i backend (engine-only) NON lo caricano.
export { GenQueryDto } from "./genquery.dto.js";
export {
  ApiOkData,
  ApiCreatedData,
  ApiPaginatedData,
  ApiIdParam,
  ApiFindOneQuery,
  ApiListQueries,
} from "./api-response.decorator.js";
