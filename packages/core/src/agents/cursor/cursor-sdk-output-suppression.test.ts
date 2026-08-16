import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CursorSdkOutputSuppressor } from './cursor-sdk-output-suppression.js';

describe('CursorSdkOutputSuppressor', () => {
  let originalStdoutWrite: typeof process.stdout.write;
  let originalStderrWrite: typeof process.stderr.write;

  beforeEach(() => {
    originalStdoutWrite = process.stdout.write.bind(process.stdout);
    originalStderrWrite = process.stderr.write.bind(process.stderr);
  });

  afterEach(() => {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  });

  it('install() replaces stdout/stderr write; uninstall() restores', () => {
    const suppressor = new CursorSdkOutputSuppressor();
    suppressor.install();
    const writeA = process.stdout.write;
    suppressor.uninstall();
    const writeB = process.stdout.write;
    expect(writeA).not.toBe(writeB);
  });

  it('runStartupScope runs fn and restores after', async () => {
    const suppressor = new CursorSdkOutputSuppressor();
    const before = process.stdout.write;
    const result = await suppressor.runStartupScope(async () => {
      const during = process.stdout.write;
      expect(during).not.toBe(before);
      return 42;
    });
    const after = process.stdout.write;
    expect(result).toBe(42);
    expect(after).toBe(before);
  });

  it('CONTROL: runStartupScope returns the fn result (always-passing)', async () => {
    const suppressor = new CursorSdkOutputSuppressor();
    const result = await suppressor.runStartupScope(async () => 'ok');
    expect(result).toBe('ok');
  });
});
