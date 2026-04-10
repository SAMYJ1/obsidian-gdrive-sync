export function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

export function getRetryDelay(error: any, attempt: number, baseDelayMs: number): number {
  if (error && error.retryAfter) {
    return error.retryAfter * 1000;
  }
  return baseDelayMs * Math.pow(2, attempt - 1);
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options?: { maxAttempts?: number; baseDelayMs?: number }
): Promise<T> {
  const maxAttempts = options?.maxAttempts ?? 3;
  const baseDelayMs = options?.baseDelayMs ?? 1000;
  let lastError: any;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      const status = error?.status;
      if (status && !isRetryableStatus(status)) {
        throw error;
      }
      if (attempt < maxAttempts) {
        const delay = getRetryDelay(error, attempt, baseDelayMs);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}
