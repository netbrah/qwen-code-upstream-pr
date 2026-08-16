/**
 * @fileoverview MCP timeout containment for the Cursor agent. The Cursor SDK
 * arms a single hard-coded 60s `setTimeout` for BOTH the MCP connect handshake
 * and individual `callTool` requests. A slow tool can be killed mid-flight at
 * 60s. We install a scoped `globalThis.setTimeout` shim that recognises the
 * SDK's MCP timers (by stack) and rewrites:
 *   - connect/listTools timers  → a short connect timeout (fail cold MCPs fast),
 *   - callTool timers           → a long tool timeout (don't kill slow tools).
 *
 * The override is a no-op for every other timer. It is install/restore scoped
 * so it only affects the brief Cursor SDK startup window. With `customTools`
 * (no bridge cold-start) this is less critical but still bounds any external
 * `mcpServers` the operator configures.
 */

const CURSOR_SDK_MCP_DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_CURSOR_MCP_TOOL_TIMEOUT_MS = 3_600_000;
const DEFAULT_CURSOR_MCP_CONNECT_TIMEOUT_MS = 10_000;
const MIN_CURSOR_MCP_CONNECT_TIMEOUT_MS = 1_000;
const MAX_NODE_TIMER_DELAY_MS = 2_147_483_647;

interface CursorMcpToolTimeoutOverrideOptions {
  timeoutMs?: number;
  connectTimeoutMs?: number;
}

export interface CursorMcpToolTimeoutOverrideState {
  installed: boolean;
  timeoutMs: number;
  connectTimeoutMs: number;
  sdkDefaultTimeoutMs: number;
}

type GlobalSetTimeout = typeof globalThis.setTimeout;
type SetTimeoutHandler = Parameters<GlobalSetTimeout>[0];
type SetTimeoutDelay = Parameters<GlobalSetTimeout>[1];
type DelegateSetTimeout = (
  handler: SetTimeoutHandler,
  delay?: SetTimeoutDelay,
  ...args: unknown[]
) => ReturnType<GlobalSetTimeout>;

let originalSetTimeout: GlobalSetTimeout | undefined;
let installedToolTimeoutMs = DEFAULT_CURSOR_MCP_TOOL_TIMEOUT_MS;
let installedConnectTimeoutMs = DEFAULT_CURSOR_MCP_CONNECT_TIMEOUT_MS;

function normalizeOverrideTimeoutMs(timeoutMs: number): number {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return DEFAULT_CURSOR_MCP_TOOL_TIMEOUT_MS;
  }
  return Math.min(
    Math.max(Math.trunc(timeoutMs), CURSOR_SDK_MCP_DEFAULT_TIMEOUT_MS),
    MAX_NODE_TIMER_DELAY_MS,
  );
}

function normalizeConnectTimeoutMs(timeoutMs: number): number {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return DEFAULT_CURSOR_MCP_CONNECT_TIMEOUT_MS;
  }
  return Math.min(
    Math.max(Math.trunc(timeoutMs), MIN_CURSOR_MCP_CONNECT_TIMEOUT_MS),
    CURSOR_SDK_MCP_DEFAULT_TIMEOUT_MS,
  );
}

function isCursorSdkMcpProtocolTimeoutStack(
  stack: string | undefined,
): boolean {
  if (!stack) {
    return false;
  }
  return (
    /node_modules[/\\]@cursor[/\\]sdk|@cursor\/sdk\/dist/.test(stack) &&
    /\b_setupTimeout\b|\bProtocol\._setupTimeout\b/.test(stack)
  );
}

export function isCursorSdkMcpToolTimeoutStack(
  stack: string | undefined,
): boolean {
  if (!stack) {
    return false;
  }
  return (
    isCursorSdkMcpProtocolTimeoutStack(stack) &&
    /\bcallTool\b|\bClient\.callTool\b|\bMcpSdkClient\.callTool\b/.test(stack)
  );
}

export function isCursorSdkMcpConnectTimeoutStack(
  stack: string | undefined,
): boolean {
  if (!stack || !isCursorSdkMcpProtocolTimeoutStack(stack)) {
    return false;
  }
  return /\bClient\.(?:connect|listTools)\b|\bMcpSdkClient\.getTools\b/.test(
    stack,
  );
}

function isCursorSdkDefaultMcpTimeout(delay: SetTimeoutDelay): boolean {
  return (
    typeof delay === 'number' && delay === CURSOR_SDK_MCP_DEFAULT_TIMEOUT_MS
  );
}

function patchedSetTimeout(
  handler: SetTimeoutHandler,
  delay?: SetTimeoutDelay,
  ...args: unknown[]
): ReturnType<GlobalSetTimeout> {
  const delegate: DelegateSetTimeout | undefined = originalSetTimeout;
  if (!delegate) {
    throw new Error(
      'Cursor MCP timeout override installed without original setTimeout',
    );
  }

  let nextDelay = delay;
  if (isCursorSdkDefaultMcpTimeout(delay)) {
    const stack = new Error().stack;
    if (isCursorSdkMcpToolTimeoutStack(stack)) {
      nextDelay = installedToolTimeoutMs;
    } else if (isCursorSdkMcpConnectTimeoutStack(stack)) {
      nextDelay = installedConnectTimeoutMs;
    }
  }

  return delegate(handler, nextDelay, ...args);
}

/**
 * Installs the scoped Cursor MCP timeout override. Idempotent: a second install
 * only refreshes the configured timeouts. Always pair with
 * {@link restoreCursorMcpToolTimeoutOverride} in a `finally`.
 */
export function installCursorMcpToolTimeoutOverride(
  options: CursorMcpToolTimeoutOverrideOptions = {},
): CursorMcpToolTimeoutOverrideState {
  installedToolTimeoutMs = normalizeOverrideTimeoutMs(
    options.timeoutMs ?? DEFAULT_CURSOR_MCP_TOOL_TIMEOUT_MS,
  );
  installedConnectTimeoutMs = normalizeConnectTimeoutMs(
    options.connectTimeoutMs ?? DEFAULT_CURSOR_MCP_CONNECT_TIMEOUT_MS,
  );

  if (!originalSetTimeout) {
    originalSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = patchedSetTimeout as GlobalSetTimeout;
  }

  return {
    installed: true,
    timeoutMs: installedToolTimeoutMs,
    connectTimeoutMs: installedConnectTimeoutMs,
    sdkDefaultTimeoutMs: CURSOR_SDK_MCP_DEFAULT_TIMEOUT_MS,
  };
}

/** Restores the original `globalThis.setTimeout`. Safe to call when not installed. */
export function restoreCursorMcpToolTimeoutOverride(): void {
  if (originalSetTimeout) {
    globalThis.setTimeout = originalSetTimeout;
    originalSetTimeout = undefined;
  }
  installedToolTimeoutMs = DEFAULT_CURSOR_MCP_TOOL_TIMEOUT_MS;
  installedConnectTimeoutMs = DEFAULT_CURSOR_MCP_CONNECT_TIMEOUT_MS;
}

export const cursorMcpToolTimeoutOverrideDefaults = {
  cursorSdkDefaultTimeoutMs: CURSOR_SDK_MCP_DEFAULT_TIMEOUT_MS,
  defaultOverrideTimeoutMs: DEFAULT_CURSOR_MCP_TOOL_TIMEOUT_MS,
  defaultConnectTimeoutMs: DEFAULT_CURSOR_MCP_CONNECT_TIMEOUT_MS,
  minConnectTimeoutMs: MIN_CURSOR_MCP_CONNECT_TIMEOUT_MS,
  maxNodeTimerDelayMs: MAX_NODE_TIMER_DELAY_MS,
} as const;
