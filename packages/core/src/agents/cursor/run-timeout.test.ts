import { describe, it, expect } from 'vitest';
import {
  withRunTimeout,
  CliRunTimeoutError,
  isCliRunTimeoutError,
} from './run-timeout.js';

describe('withRunTimeout', () => {
  it('returns fn result when fn completes before timeout', async () => {
    const result = await withRunTimeout(async () => 42, 1);
    expect(result).toBe(42);
  });

  it('throws CliRunTimeoutError when timeout elapses', async () => {
    await expect(
      withRunTimeout(async () => {
        await new Promise((r) => setTimeout(r, 1000));
        return 42;
      }, 0.01),
    ).rejects.toThrow(CliRunTimeoutError);
  });

  it('isCliRunTimeoutError identifies the error', async () => {
    try {
      await withRunTimeout(async () => {
        await new Promise((r) => setTimeout(r, 1000));
      }, 0.01);
    } catch (e) {
      expect(isCliRunTimeoutError(e)).toBe(true);
    }
  });

  it('invokes onTimeout callback when timeout fires', async () => {
    let called = false;
    await expect(
      withRunTimeout(
        async () => {
          await new Promise((r) => setTimeout(r, 1000));
        },
        0.01,
        () => {
          called = true;
        },
      ),
    ).rejects.toThrow();
    expect(called).toBe(true);
  });

  it('CONTROL: zero-duration fn resolves immediately (always-passing)', async () => {
    expect(await withRunTimeout(async () => 'done', 1)).toBe('done');
  });
});
