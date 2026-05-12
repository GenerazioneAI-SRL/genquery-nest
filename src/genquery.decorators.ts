import { Inject } from "@nestjs/common";
import { getGenQueryEngineToken } from "./genquery.tokens.js";

/**
 * Inject the `GenQueryEngine` registered by `GenQueryModule.forRoot(...)`.
 *
 *   constructor(
 *     @InjectGenQueryEngine() private readonly engine: GenQueryEngine<...>,
 *   ) {}
 *
 * Pass a `name` to inject a non-default engine:
 *
 *   @InjectGenQueryEngine("reports")
 */
export const InjectGenQueryEngine = (name?: string): ParameterDecorator =>
  Inject(getGenQueryEngineToken(name));
