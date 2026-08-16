/**
 * Cursor SDK startup output suppression.
 *
 * The Cursor SDK writes raw lines to `process.stdout` / `process.stderr` /
 * `console.*` during `Agent.create()` (e.g. setting-source loading and late
 * `managed_skills.removed` lines). The TUI shares the terminal with the SDK,
 * so those raw writes corrupt the rendered frame. This module scopes that
 * noise: {@link CursorSdkOutputSuppressor.runStartupScope} installs the
 * patches around the SDK call and restores them in `finally`.
 *
 * Patching `process.stdout.write` / `process.stderr.write` also captures
 * `console.*` output, since Node's `console` writes through those streams.
 */

/** Known late Cursor startup noise that can arrive AFTER `Agent.create()`. */
const KNOWN_CURSOR_STARTUP_NOISE = [
  'managed_skills.removed',
  'managed_skills.added',
  'managed_skills.updated',
  'managed_skills.skipped',
] as const;

/**
 * Whether a raw write is known Cursor startup noise. Pure + exported for
 * regression tests.
 */
export function isKnownCursorStartupNoise(chunk: unknown): boolean {
  const text =
    typeof chunk === 'string'
      ? chunk
      : chunk instanceof Uint8Array
        ? Buffer.from(chunk).toString('utf8')
        : '';
  if (!text) {
    return false;
  }
  return KNOWN_CURSOR_STARTUP_NOISE.some((needle) => text.includes(needle));
}

type WriteCallback = (err?: Error | null) => void;

/** Single-signature view of a Node stream `write` method. */
type StreamWrite = (
  chunk: string | Uint8Array,
  encodingOrCb?: BufferEncoding | WriteCallback,
  cb?: WriteCallback,
) => boolean;

type WritableStream = typeof process.stdout | typeof process.stderr;

/**
 * Scoped suppressor for Cursor SDK startup output. Call
 * {@link runStartupScope} around the SDK `Agent.create`/`resume` call; the
 * suppressor installs the patches on entry and restores them in `finally`.
 * {@link install} / {@link uninstall} are also exposed for standalone use.
 */
export class CursorSdkOutputSuppressor {
  private installed = false;
  private startupScopeActive = false;
  private stdoutStream?: WritableStream;
  private originalStdoutWrite?: StreamWrite;
  private stderrStream?: WritableStream;
  private originalStderrWrite?: StreamWrite;

  /** Patches stdout/stderr to suppress writes. Idempotent. */
  install(): void {
    if (this.installed) {
      return;
    }
    this.installed = true;

    this.stdoutStream = process.stdout;
    this.originalStdoutWrite = process.stdout.write as unknown as StreamWrite;
    this.stderrStream = process.stderr;
    this.originalStderrWrite = process.stderr.write as unknown as StreamWrite;

    process.stdout.write = this.makeStreamWrite(
      this.stdoutStream,
      this.originalStdoutWrite,
    ) as typeof process.stdout.write;
    process.stderr.write = this.makeStreamWrite(
      this.stderrStream,
      this.originalStderrWrite,
    ) as typeof process.stderr.write;
  }

  /**
   * Runs `fn` (the SDK `Agent.create`/`resume` call) with stdout/stderr
   * suppression active. Installs on entry, uninstalls in `finally` even if
   * `fn` throws. Returns `fn`'s result.
   */
  async runStartupScope<T>(fn: () => Promise<T>): Promise<T> {
    this.install();
    this.startupScopeActive = true;
    try {
      return await fn();
    } finally {
      this.startupScopeActive = false;
      this.uninstall();
    }
  }

  /** Restores the original stdout/stderr. Safe if never installed. */
  uninstall(): void {
    if (!this.installed) {
      return;
    }
    this.installed = false;
    this.startupScopeActive = false;
    if (this.stdoutStream && this.originalStdoutWrite) {
      this.stdoutStream.write = this
        .originalStdoutWrite as typeof process.stdout.write;
    }
    if (this.stderrStream && this.originalStderrWrite) {
      this.stderrStream.write = this
        .originalStderrWrite as typeof process.stderr.write;
    }
    this.stdoutStream = undefined;
    this.stderrStream = undefined;
    this.originalStdoutWrite = undefined;
    this.originalStderrWrite = undefined;
  }

  private shouldSuppress(chunk: unknown): boolean {
    if (this.startupScopeActive) {
      return true;
    }
    return isKnownCursorStartupNoise(chunk);
  }

  private makeStreamWrite(
    stream: WritableStream,
    original: StreamWrite,
  ): StreamWrite {
    const patched = (
      chunk: string | Uint8Array,
      encodingOrCb?: BufferEncoding | WriteCallback,
      cb?: WriteCallback,
    ): boolean => {
      if (this.shouldSuppress(chunk)) {
        const callback = typeof encodingOrCb === 'function' ? encodingOrCb : cb;
        if (callback) {
          callback();
        }
        return true;
      }
      if (typeof encodingOrCb === 'function') {
        return original.call(stream, chunk, encodingOrCb);
      }
      if (typeof encodingOrCb === 'string') {
        return original.call(stream, chunk, encodingOrCb, cb);
      }
      return original.call(stream, chunk, cb);
    };
    return patched;
  }
}
