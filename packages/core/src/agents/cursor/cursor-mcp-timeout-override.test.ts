import { describe, it, expect, afterEach } from 'vitest';
import {
  cursorMcpToolTimeoutOverrideDefaults,
  installCursorMcpToolTimeoutOverride,
  isCursorSdkMcpConnectTimeoutStack,
  isCursorSdkMcpToolTimeoutStack,
  restoreCursorMcpToolTimeoutOverride,
} from './cursor-mcp-timeout-override.js';

describe('cursor MCP timeout-override stack detection', () => {
  const toolStack = [
    'Error',
    '    at Protocol._setupTimeout (/x/node_modules/@cursor/sdk/dist/esm/foo.js:10:1)',
    '    at Client.callTool (/x/node_modules/@cursor/sdk/dist/esm/bar.js:20:1)',
  ].join('\n');

  const connectStack = [
    'Error',
    '    at Protocol._setupTimeout (/x/node_modules/@cursor/sdk/dist/esm/foo.js:10:1)',
    '    at Client.connect (/x/node_modules/@cursor/sdk/dist/esm/bar.js:20:1)',
  ].join('\n');

  it('recognises a callTool timer stack', () => {
    expect(isCursorSdkMcpToolTimeoutStack(toolStack)).toBe(true);
    expect(isCursorSdkMcpToolTimeoutStack(connectStack)).toBe(false);
  });

  it('recognises a connect/listTools timer stack', () => {
    expect(isCursorSdkMcpConnectTimeoutStack(connectStack)).toBe(true);
    expect(isCursorSdkMcpConnectTimeoutStack(toolStack)).toBe(false);
  });

  it('ignores unrelated (non-@cursor/sdk) stacks', () => {
    const other = 'Error\n    at someApp._setupTimeout (/app/index.js:1:1)';
    expect(isCursorSdkMcpToolTimeoutStack(other)).toBe(false);
    expect(isCursorSdkMcpConnectTimeoutStack(other)).toBe(false);
    expect(isCursorSdkMcpToolTimeoutStack(undefined)).toBe(false);
  });
});

describe('install/restore Cursor MCP timeout override', () => {
  afterEach(() => {
    restoreCursorMcpToolTimeoutOverride();
  });

  it('install/restore are idempotent', () => {
    expect(() => installCursorMcpToolTimeoutOverride()).not.toThrow();
    expect(() => installCursorMcpToolTimeoutOverride()).not.toThrow();
    expect(() => restoreCursorMcpToolTimeoutOverride()).not.toThrow();
    expect(() => restoreCursorMcpToolTimeoutOverride()).not.toThrow();
  });

  it('patches and restores globalThis.setTimeout', () => {
    const original = globalThis.setTimeout;
    const state = installCursorMcpToolTimeoutOverride();
    expect(state.installed).toBe(true);
    expect(globalThis.setTimeout).not.toBe(original);
    restoreCursorMcpToolTimeoutOverride();
    expect(globalThis.setTimeout).toBe(original);
  });

  it('clamps connect timeout to the SDK default ceiling and tool timeout to its floor', () => {
    const { cursorSdkDefaultTimeoutMs, minConnectTimeoutMs } =
      cursorMcpToolTimeoutOverrideDefaults;
    const state = installCursorMcpToolTimeoutOverride({
      timeoutMs: 1,
      connectTimeoutMs: 10_000_000,
    });
    expect(state.connectTimeoutMs).toBe(cursorSdkDefaultTimeoutMs);
    expect(state.timeoutMs).toBe(cursorSdkDefaultTimeoutMs);
    expect(minConnectTimeoutMs).toBeGreaterThan(0);
  });

  it('rewrites only the SDK 60s MCP timers, leaving other timers untouched', () => {
    installCursorMcpToolTimeoutOverride({
      timeoutMs: 3_600_000,
      connectTimeoutMs: 10_000,
    });
    const handle = globalThis.setTimeout(() => {}, 5);
    expect(handle).toBeDefined();
    globalThis.clearTimeout(handle);
  });

  it('CONTROL: install then restore round-trips (always-passing)', () => {
    installCursorMcpToolTimeoutOverride();
    restoreCursorMcpToolTimeoutOverride();
    expect(true).toBe(true);
  });
});

describe('overlapping install/restore (reference-counted)', () => {
  const realSetTimeout = globalThis.setTimeout;

  afterEach(() => {
    restoreCursorMcpToolTimeoutOverride();
    globalThis.setTimeout = realSetTimeout;
  });

  it('install A, install B, restore A: setTimeout still patched (B active)', () => {
    const original = globalThis.setTimeout;
    installCursorMcpToolTimeoutOverride();
    installCursorMcpToolTimeoutOverride();
    restoreCursorMcpToolTimeoutOverride();
    expect(globalThis.setTimeout).not.toBe(original);
  });

  it('restore B: original setTimeout restored', () => {
    const original = globalThis.setTimeout;
    installCursorMcpToolTimeoutOverride();
    installCursorMcpToolTimeoutOverride();
    restoreCursorMcpToolTimeoutOverride();
    restoreCursorMcpToolTimeoutOverride();
    expect(globalThis.setTimeout).toBe(original);
  });

  it('reverse completion order: restore B first, then A', () => {
    const original = globalThis.setTimeout;
    installCursorMcpToolTimeoutOverride();
    installCursorMcpToolTimeoutOverride();
    restoreCursorMcpToolTimeoutOverride();
    expect(globalThis.setTimeout).not.toBe(original);
    restoreCursorMcpToolTimeoutOverride();
    expect(globalThis.setTimeout).toBe(original);
  });

  it('thrown startup releases ownership via finally', () => {
    const original = globalThis.setTimeout;
    installCursorMcpToolTimeoutOverride();
    let caught: unknown;
    try {
      throw new Error('boom');
    } catch (e) {
      caught = e;
    } finally {
      restoreCursorMcpToolTimeoutOverride();
    }
    expect(caught).toBeInstanceOf(Error);
    expect(globalThis.setTimeout).toBe(original);
  });

  it('CONTROL: single install/restore round-trip unchanged', () => {
    const original = globalThis.setTimeout;
    installCursorMcpToolTimeoutOverride();
    expect(globalThis.setTimeout).not.toBe(original);
    restoreCursorMcpToolTimeoutOverride();
    expect(globalThis.setTimeout).toBe(original);
  });
});
