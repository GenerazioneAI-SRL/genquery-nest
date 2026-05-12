/**
 * Default name used when the consumer does not pass one to
 * `GenQueryModule.forRoot(...)` / `forRootAsync(...)`.
 */
export const DEFAULT_GENQUERY_ENGINE_NAME = "default";

/**
 * Build the DI token used to provide / inject a `GenQueryEngine`.
 *
 *   const engineToken = getGenQueryEngineToken();          // default engine
 *   const engineToken = getGenQueryEngineToken("reports"); // named engine
 */
export function getGenQueryEngineToken(name?: string): string {
  const n = name ?? DEFAULT_GENQUERY_ENGINE_NAME;
  return `GenQueryEngine:${n}`;
}
