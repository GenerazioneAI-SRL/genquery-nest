import { DynamicModule, Module } from "@nestjs/common";
import { GENQUERY_FEDERATION_OPTIONS } from "./genquery-federation.tokens.js";
import {
  GenQueryFederation,
  type GenQueryFederationOptions,
} from "./genquery-federation.service.js";

/**
 * Federated genquery for orchestrators (typically the API gateway).
 *
 * Register once with the datamodel of every reachable service + the DI token
 * of its ClientProxy; inject `GenQueryFederation` and send list/find cmds
 * through it — cross-service includes resolve automatically (discovery is
 * convention-driven from the datamodels, zero per-resource declarations):
 *
 *   GenQueryFederationModule.forRoot({
 *     services: [
 *       { service: 'skillID', clientToken: 'id', datamodel: idDatamodel },
 *       { service: 'skillHr', clientToken: 'hr', datamodel: hrDatamodel },
 *     ],
 *   })
 *
 *   // controller
 *   return this.federation.send({
 *     client: 'hr',
 *     cmd: 'structure-juridical-individuals.findAll',
 *     model: 'StructureJuridicalIndividual',
 *     payload: { juridicalId: tenantId, ...genquery },
 *   });
 */
@Module({})
export class GenQueryFederationModule {
  static forRoot(
    options: GenQueryFederationOptions & { global?: boolean },
  ): DynamicModule {
    const { global, ...opts } = options;
    return {
      module: GenQueryFederationModule,
      global: global ?? true,
      providers: [
        { provide: GENQUERY_FEDERATION_OPTIONS, useValue: opts },
        GenQueryFederation,
      ],
      exports: [GenQueryFederation],
    };
  }
}
