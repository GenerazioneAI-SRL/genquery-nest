import { Inject, Injectable, Logger } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { firstValueFrom, timeout, type Observable } from "rxjs";
import {
  buildFederationIndex,
  collectForeignIds,
  mergeFederatedRows,
  planFederatedIncludes,
  pluralizeCamel,
  toFederatedShape,
  FederationPlanError,
  type FederatedIncludePlan,
  type FederatedServiceShape,
  type FederationIndex,
} from "@generazioneai/genquery";
import { GENQUERY_FEDERATION_OPTIONS } from "./genquery-federation.tokens.js";

/**
 * Structural ClientProxy shape (type-only — `@nestjs/microservices` is not a
 * runtime dependency of this module; any NATS/TCP ClientProxy satisfies it).
 */
export interface MessageClientLike {
  send(pattern: unknown, payload: unknown): Observable<unknown>;
}

export interface FederationServiceConfig {
  /** Owning service name as it appears in its datamodel/manifests — e.g. 'skillID'. */
  service: string;
  /** DI token of the service's ClientProxy (e.g. 'id', 'hr' in the gateway ConnectorModule). */
  clientToken: string | symbol;
  /**
   * The service's datamodel. Accepts either the full DMMF (`{ models: [{ name,
   * fields }] }` — reduced internally) or the compact federated shape
   * (`{ models: [{ name, relations, scalars }] }` from a generated union file).
   */
  datamodel: { models: readonly any[] };
  /**
   * Per-model override of the conventional cmd prefix
   * (`pluralizeCamel(model)`) — e.g. `{ Person: 'people' }`.
   */
  cmdOverrides?: Record<string, string>;
}

export interface GenQueryFederationOptions {
  services: FederationServiceConfig[];
  /** Max ids per batch fetch towards a target service. Default 200 (typical genquery page cap). */
  chunkSize?: number;
  /** Per-RPC timeout in ms. Default 15000. */
  timeoutMs?: number;
}

export interface FederatedSendArgs {
  /** ClientProxy token of the service that owns the cmd. */
  client: string | symbol;
  /** NATS cmd — e.g. 'structure-juridical-individuals.findAll'. */
  cmd: string;
  /** DMMF PascalCase model returned by the cmd (drives include discovery). */
  model: string;
  /** Full payload: genquery envelope + trusted scope keys (juridicalId, auth, ...). */
  payload?: Record<string, any>;
  /**
   * Federated keys resolved even when the client did not ask for them.
   * Back-compat with endpoints that historically always enriched.
   */
  alwaysInclude?: readonly string[];
  /** Per-key explicit targets for ambiguous/unconventional relations. */
  overrides?: Record<string, { service: string; model?: string; fk?: string }>;
  timeoutMs?: number;
}

/**
 * Federated genquery transport: sends a cmd to its owning service and
 * transparently resolves cross-service includes discovered from the
 * datamodel union (see `planFederatedIncludes` in @generazioneai/genquery).
 *
 * Resolution goes through the target service's own genquery `<model>s.findAll`
 * (searchBy `id: [...]` → IN), so tenant scoping, authz enforcement and
 * field-level read stripping of the OWNER service apply to the included rows
 * exactly as if the client had queried them directly.
 */
@Injectable()
export class GenQueryFederation {
  private readonly logger = new Logger(GenQueryFederation.name);
  private readonly index: FederationIndex;
  private readonly byService = new Map<string, FederationServiceConfig>();
  private readonly byClientToken = new Map<string | symbol, FederationServiceConfig>();
  private readonly chunkSize: number;
  private readonly timeoutMs: number;

  constructor(
    @Inject(GENQUERY_FEDERATION_OPTIONS)
    options: GenQueryFederationOptions,
    private readonly moduleRef: ModuleRef,
  ) {
    const shapes: FederatedServiceShape[] = options.services.map((svc) => {
      this.byService.set(svc.service, svc);
      this.byClientToken.set(svc.clientToken, svc);
      const models = svc.datamodel.models;
      // Full DMMF (has `fields`) → reduce; compact shape → use as-is.
      return models.length && (models[0] as any).fields
        ? toFederatedShape(svc.service, svc.datamodel as any)
        : { service: svc.service, models: models as any };
    });
    this.index = buildFederationIndex(shapes);
    this.chunkSize = options.chunkSize ?? 200;
    this.timeoutMs = options.timeoutMs ?? 15000;
  }

  async send<T = any>(args: FederatedSendArgs): Promise<T> {
    const cfg = this.byClientToken.get(args.client);
    if (!cfg) {
      throw new FederationPlanError(
        `Federation: no service registered for client token '${String(args.client)}'`,
        String(args.client),
      );
    }
    const payload = args.payload ?? {};
    const plan = planFederatedIncludes({
      index: this.index,
      service: cfg.service,
      model: args.model,
      include: this.asObject(payload.include),
      alwaysInclude: args.alwaysInclude,
      overrides: args.overrides,
    });

    // Forward with the federated keys stripped (local engine sees only its own).
    const forward = { ...payload };
    if (plan.localInclude) forward.include = plan.localInclude;
    else delete forward.include;

    const ms = args.timeoutMs ?? this.timeoutMs;
    const result = await this.rpc<T>(args.client, args.cmd, forward, ms);
    if (!plan.remote.length) return result;

    const rows = this.extractRows(result);
    if (rows.length) {
      await Promise.all(plan.remote.map((p) => this.resolvePlan(p, rows, ms)));
    }
    return result;
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private async resolvePlan(
    plan: FederatedIncludePlan,
    rows: any[],
    timeoutMs: number,
  ): Promise<void> {
    const ids = collectForeignIds(rows, plan.fk);
    if (!ids.length) {
      mergeFederatedRows(rows, plan, []);
      return;
    }
    const target = this.byService.get(plan.targetService);
    if (!target) {
      throw new FederationPlanError(
        `Federation: include '${plan.key}' targets service '${plan.targetService}' which has no registered client`,
        plan.key,
      );
    }
    const prefix =
      target.cmdOverrides?.[plan.targetModel] ?? pluralizeCamel(plan.targetModel);

    const fetched: any[] = [];
    for (let i = 0; i < ids.length; i += this.chunkSize) {
      const chunk = ids.slice(i, i + this.chunkSize);
      const envelope: Record<string, unknown> = {
        // genquery IN: array value on the id field.
        searchBy: { id: chunk },
        pagination: { page: 0, perPage: chunk.length },
        ...(plan.nested?.include ? { include: plan.nested.include } : {}),
        ...(plan.nested?.select ? { select: plan.nested.select } : {}),
      };
      const res = await this.rpc<unknown>(
        target.clientToken,
        `${prefix}.findAll`,
        envelope,
        timeoutMs,
      );
      fetched.push(...this.extractRows(res));
    }
    mergeFederatedRows(rows, plan, fetched);
  }

  private rpc<T>(
    clientToken: string | symbol,
    cmd: string,
    payload: unknown,
    timeoutMs: number,
  ): Promise<T> {
    const client = this.moduleRef.get<MessageClientLike>(clientToken as any, {
      strict: false,
    });
    const obs = client.send({ cmd }, payload).pipe(timeout(timeoutMs));
    return firstValueFrom(obs) as Promise<T>;
  }

  /** Rows of a genquery envelope / bare array / single-record response. */
  private extractRows(result: unknown): any[] {
    if (Array.isArray(result)) return result;
    if (result && typeof result === "object") {
      const data = (result as Record<string, unknown>).data;
      if (Array.isArray(data)) return data;
      return [result];
    }
    return [];
  }

  private asObject(v: unknown): Record<string, unknown> | undefined {
    return v && typeof v === "object" && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : undefined;
  }
}
