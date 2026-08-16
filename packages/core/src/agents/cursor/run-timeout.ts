/**
 * @fileoverview Run timeout helper for cursor-coder. Races the fn against a
 * wall-clock timeout; on timeout, invokes the cancel callback and throws.
 */

export class CliRunTimeoutError extends Error {
  constructor(message = 'Cursor agent run timed out.') {
    super(message);
    this.name = 'CliRunTimeoutError';
  }
}

export function isCliRunTimeoutError(e: unknown): boolean {
  return e instanceof CliRunTimeoutError;
}

export async function withRunTimeout<T>(
  fn: () => Promise<T>,
  maxMinutes?: number,
  onTimeout?: () => void,
): Promise<T> {
  if (!maxMinutes || maxMinutes <= 0) {
    return fn();
  }
  const ms = maxMinutes * 60 * 1000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      onTimeout?.();
      reject(new CliRunTimeoutError());
    }, ms);
  });
  try {
    return await Promise.race([fn(), timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
