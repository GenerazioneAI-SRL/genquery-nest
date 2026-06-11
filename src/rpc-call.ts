import {
  firstValueFrom,
  type Observable,
  timeout,
  catchError,
  throwError,
  retry,
  timer,
} from "rxjs";
import { Logger } from "@nestjs/common";

const DEFAULT_RPC_TIMEOUT = parseInt(process.env.RPC_TIMEOUT_MS ?? "", 10) || 30000;
const DEFAULT_RPC_RETRIES = parseInt(process.env.RPC_MAX_RETRIES ?? "", 10) || 3;

const logger = new Logger("RpcCall");

/**
 * Wrappa un Observable RPC (es. `ClientProxy.send()`) con retry + timeout.
 *
 * - Riprova SOLO sugli errori "No responders" / "Empty response" / NO_RESPONDERS
 *   (servizio temporaneamente giù durante un rolling update K8s), con backoff
 *   esponenziale (1s, 2s, 4s, cap 5s).
 * - NON riprova gli errori di business (validazione, not found, ...).
 *
 * Default configurabili via env `RPC_TIMEOUT_MS` (30s) e `RPC_MAX_RETRIES` (3).
 */
export function rpcCall<T>(
  observable: Observable<T>,
  timeoutMs: number = DEFAULT_RPC_TIMEOUT,
  maxRetries: number = DEFAULT_RPC_RETRIES,
): Promise<T> {
  return firstValueFrom(
    observable.pipe(
      timeout(timeoutMs),
      retry({
        count: maxRetries,
        delay: (error: any, retryCount: number) => {
          const errorMsg = error?.message || error?.toString?.() || "";
          if (
            errorMsg.includes("No responders") ||
            errorMsg.includes("Empty response") ||
            errorMsg.includes("no subscribers") ||
            error?.code === "NO_RESPONDERS"
          ) {
            const delayMs = Math.min(1000 * Math.pow(2, retryCount - 1), 5000);
            logger.warn(
              `No responders — retry ${retryCount}/${maxRetries} in ${delayMs}ms`,
            );
            return timer(delayMs);
          }
          return throwError(() => error);
        },
      }),
      catchError((err: any) => {
        if (err?.name === "TimeoutError") {
          return throwError(
            () => new Error(`RPC call timed out after ${timeoutMs}ms`),
          );
        }
        return throwError(() => err);
      }),
    ),
  );
}
