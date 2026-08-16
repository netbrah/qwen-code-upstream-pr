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

let stdoutRefCount = 0;
let stderrRefCount = 0;
let trueOriginalStdoutWrite: StreamWrite | undefined;
let trueOriginalStderrWrite: StreamWrite | undefined;
let installedStdoutPatch: typeof process.stdout.write | undefined;
let installedStderrPatch: typeof process.stderr.write | undefined;

function installStream(
  makeWrite: (original: StreamWrite) => StreamWrite,
  kind: 'stdout' | 'stderr',
): void {
  if (kind === 'stdout') {
    const current = process.stdout.write;
    const drifted =
      stdoutRefCount > 0 &&
      installedStdoutPatch !== undefined &&
      current !== installedStdoutPatch;
    if (drifted) {
      stdoutRefCount = 0;
      trueOriginalStdoutWrite = undefined;
      installedStdoutPatch = undefined;
    }
    if (stdoutRefCount === 0) {
      trueOriginalStdoutWrite = current as unknown as StreamWrite;
      const patch = makeWrite(trueOriginalStdoutWrite);
      process.stdout.write = patch as typeof process.stdout.write;
      installedStdoutPatch = patch as typeof process.stdout.write;
    }
    stdoutRefCount++;
  } else {
    const current = process.stderr.write;
    const drifted =
      stderrRefCount > 0 &&
      installedStderrPatch !== undefined &&
      current !== installedStderrPatch;
    if (drifted) {
      stderrRefCount = 0;
      trueOriginalStderrWrite = undefined;
      installedStderrPatch = undefined;
    }
    if (stderrRefCount === 0) {
      trueOriginalStderrWrite = current as unknown as StreamWrite;
      const patch = makeWrite(trueOriginalStderrWrite);
      process.stderr.write = patch as typeof process.stderr.write;
      installedStderrPatch = patch as typeof process.stderr.write;
    }
    stderrRefCount++;
  }
}

function uninstallStream(kind: 'stdout' | 'stderr'): void {
  if (kind === 'stdout') {
    if (stdoutRefCount === 0) {
      return;
    }
    stdoutRefCount--;
    if (stdoutRefCount === 0 && trueOriginalStdoutWrite) {
      process.stdout.write =
        trueOriginalStdoutWrite as typeof process.stdout.write;
      trueOriginalStdoutWrite = undefined;
      installedStdoutPatch = undefined;
    }
  } else {
    if (stderrRefCount === 0) {
      return;
    }
    stderrRefCount--;
    if (stderrRefCount === 0 && trueOriginalStderrWrite) {
      process.stderr.write =
        trueOriginalStderrWrite as typeof process.stderr.write;
      trueOriginalStderrWrite = undefined;
      installedStderrPatch = undefined;
    }
  }
}

/**
 * Scoped suppressor for Cursor SDK startup output. Call
 * {@link runStartupScope} around the SDK `Agent.create`/`resume` call; the
 * suppressor installs the patches on entry and restores them in `finally`.
 * {@link install} / {@link uninstall} are also exposed for standalone use.
 *
 * The stdout/stderr patches are reference-counted at the module level so
 * overlapping suppressor instances do not clobber each other: the true
 * original `write` is captured on the first install and restored only when
 * the last owner uninstalls.
 */
export class CursorSdkOutputSuppressor {
  private installed = false;
  private startupScopeActive = false;

  /** Patches stdout/stderr to suppress writes. Idempotent per-instance. */
  install(): void {
    if (this.installed) {
      return;
    }
    this.installed = true;
    installStream((o) => this.makeStreamWrite(process.stdout, o), 'stdout');
    installStream((o) => this.makeStreamWrite(process.stderr, o), 'stderr');
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

  /** Releases one owner's reference; restores the true original when last. */
  uninstall(): void {
    if (!this.installed) {
      return;
    }
    this.installed = false;
    this.startupScopeActive = false;
    uninstallStream('stdout');
    uninstallStream('stderr');
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
