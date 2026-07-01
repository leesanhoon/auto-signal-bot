type RetryOptions = {
  maxAttempts?: number;
  baseDelayMs?: number;
  isRetryable?: (error: unknown) => boolean;
  onRetry?: (
    error: unknown,
    attempt: number,
    maxAttempts: number,
    delayMs: number,
  ) => void;
};

const DEFAULT_RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

function getErrorField(error: unknown, key: string): unknown {
  if (!error || typeof error !== "object") return undefined;
  return (error as Record<string, unknown>)[key];
}

function getStatusCode(error: unknown): number | undefined {
  const candidates = [
    getErrorField(error, "status"),
    getErrorField(error, "statusCode"),
    getErrorField(error, "code"),
    getErrorField(getErrorField(error, "error"), "code"),
  ];

  for (const value of candidates) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && /^\d+$/.test(value)) {
      return Number(value);
    }
  }

  return undefined;
}

export function isRetryableError(error: unknown): boolean {
  const statusCode = getStatusCode(error);
  if (statusCode !== undefined && DEFAULT_RETRYABLE_STATUS.has(statusCode)) {
    return true;
  }

  const status = getErrorField(error, "status");
  if (
    typeof status === "string" &&
    /UNAVAILABLE|RESOURCE_EXHAUSTED/i.test(status)
  ) {
    return true;
  }

  const message = error instanceof Error ? error.message : String(error);
  if (/"code"\s*:\s*(429|500|502|503|504)/.test(message)) return true;
  if (/UNAVAILABLE|RESOURCE_EXHAUSTED|overloaded|high demand/i.test(message))
    return true;
  if (
    /ETIMEDOUT|ECONNRESET|fetch failed|network error|socket hang up/i.test(
      message,
    )
  )
    return true;

  return false;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 2_000;
  const retryable = options.isRetryable ?? isRetryableError;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts || !retryable(error)) {
        throw error;
      }

      const delayMs = baseDelayMs * 2 ** (attempt - 1);
      options.onRetry?.(error, attempt, maxAttempts, delayMs);
      await delay(delayMs);
    }
  }

  throw lastError;
}
