# Cursor-coder Subagent Port — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the `cursor-coder` subagent (a Cursor-SDK-backed coding subagent that drives an external `@cursor/sdk` agent loop and bridges qwen's tool surface into it via the native `customTools` API) into upstream qwen-code as a default-off builtin subagent.

**Architecture:** Approach C — `cursor-coder` registered in `BuiltinAgentRegistry` with an `externalInvocation: { kind: 'cursor' }` discriminant on `SubagentConfig`. One dispatch hook in `tools/agent/agent.ts` routes `kind:'cursor'` configs to `CursorAgentInvocation extends BaseToolInvocation` instead of `AgentHeadless`. Tool surface exposed in-process via `@cursor/sdk`'s native `customTools` API (no loopback HTTP bridge). Gated on `CURSOR_API_KEY`.

**Tech Stack:** TypeScript (strict, ESM), `@cursor/sdk@^1.0.18` (lazy-imported), `@modelcontextprotocol/sdk` (existing dep), vitest, upstream's `BuiltinAgentRegistry` + `SubagentConfig` + `BaseToolInvocation` + `ToolRegistry`.

**Spec:** `docs/superpowers/specs/2026-08-16-cursor-coder-port-design.md`

## Global Constraints

- ESM only; no `any` types; no relative imports between packages.
- `kebab-case.ts` for `.ts` files in `packages/core/src`; tests collocated as `file.test.ts`.
- `@cursor/sdk` lazy-imported (`await import('@cursor/sdk')`) — never static-import in production code.
- `CURSOR_API_KEY` is the env gate; `QWEN_CURSOR_*` for debug/trace env vars (rebranded from `APEX_CURSOR_*`).
- No NetApp corp-network code (curl shim, `ensureCursorH1Config`, `APEX_CURSOR_HTTPS_PROXY` env scoping).
- No loopback HTTP bridge code (`cursor-tool-bridge*.ts` is dropped).
- Comments default to none; only add where _why_ is non-obvious.
- Node.js `>=22`.
- Run tests from within `packages/core`: `cd packages/core && npx vitest run src/path/to/file.test.ts`.
- Build/typecheck from repo root: `npm run build && npm run typecheck`.
- Lint from repo root: `npm run lint`.

---

## File Structure

```
packages/core/src/agents/cursor/
  cursor-invocation.ts          CursorAgentInvocation + pure mappers
  cursor-invocation.test.ts     mapper + executor tests
  cursor-custom-tools.ts        buildCustomTools() — registry → SDK customTools
  cursor-custom-tools.test.ts   customTools builder tests
  cursor-sdk-output-suppression.ts   CursorSdkOutputSuppressor
  cursor-sdk-output-suppression.test.ts
  cursor-mcp-timeout-override.ts     install/restore MCP timeout override
  cursor-mcp-timeout-override.test.ts
  run-timeout.ts                withRunTimeout + CliRunTimeoutError (minimal port)
  run-timeout.test.ts
  types.ts                      structural SDK type mirrors + cursor def type
  index.ts                      public exports
  __fixtures__/
    cursor-sdk-stream-sample.jsonl   recorded SDK message stream for fixture tests

packages/core/src/subagents/
  types.ts                      (EDIT) add ExternalAgentInvocation + externalInvocation field
  builtin-agents.ts             (EDIT) add cursor-coder entry (gated on CURSOR_API_KEY)
  builtin-agents.test.ts        (EDIT) add cursor-coder entry tests

packages/core/src/tools/agent/
  agent.ts                      (EDIT) add dispatch hook for externalInvocation
  agent.test.ts                 (EDIT) add dispatch-hook test

packages/core/package.json      (EDIT) add @cursor/sdk dependency
```

---

## Task 1: Add `@cursor/sdk` dependency

**Files:**
- Modify: `packages/core/package.json`

**Interfaces:**
- Produces: `@cursor/sdk@^1.0.18` available as a lazy import in `packages/core`.

- [ ] **Step 1: Add the dependency**

Edit `packages/core/package.json` `dependencies` block — add after the existing `"@anthropic-ai/sdk"` line (or alphabetical position near it):

```json
    "@cursor/sdk": "^1.0.18",
```

- [ ] **Step 2: Install**

Run: `cd packages/core && npm install`
Expected: `@cursor/sdk` + platform-specific optional deps installed. `node_modules/@cursor/sdk` exists.

- [ ] **Step 3: Verify the lazy import resolves**

Run: `cd packages/core && node -e "console.log(typeof (await import('@cursor/sdk')).Agent)"` (must run from a context that supports top-level await; if not, wrap in an async IIFE)
Expected: prints `function` (the `Agent` static is exported).

If the SDK's main export shape differs, inspect `node_modules/@cursor/sdk/dist/esm/index.d.ts` and adjust the structural mirror types in Task 5 accordingly.

- [ ] **Step 4: Commit**

```bash
git add packages/core/package.json packages/core/package-lock.json
git commit -m "feat(core): add @cursor/sdk dependency for cursor-coder subagent"
```

---

## Task 2: Add `ExternalAgentInvocation` type + `externalInvocation` field to `SubagentConfig`

**Files:**
- Modify: `packages/core/src/subagents/types.ts`
- Test: `packages/core/src/subagents/types.test.ts`

**Interfaces:**
- Produces: `ExternalAgentInvocation` interface exported from `subagents/types.ts`; `SubagentConfig.externalInvocation?: ExternalAgentInvocation` field.

- [ ] **Step 1: Write the failing test**

Append to `packages/core/src/subagents/types.test.ts` (or create if the test file doesn't cover this — check existing content first):

```ts
import { describe, it, expect } from 'vitest';
import type { SubagentConfig, ExternalAgentInvocation } from './types.js';

describe('ExternalAgentInvocation', () => {
  it('accepts a cursor-kind discriminant', () => {
    const inv: ExternalAgentInvocation = {
      kind: 'cursor',
      cursorModel: 'default',
      trust: true,
      isolatedCwd: false,
      cursorRun: { sandbox: { enabled: false }, settingSources: ['project'] },
    };
    expect(inv.kind).toBe('cursor');
    expect(inv.cursorModel).toBe('default');
    expect(inv.trust).toBe(true);
  });

  it('allows optional modelParams', () => {
    const inv: ExternalAgentInvocation = {
      kind: 'cursor',
      cursorModel: 'default',
      trust: true,
      isolatedCwd: false,
      modelParams: { reasoning: 'high', thinking: true },
    };
    expect(inv.modelParams?.reasoning).toBe('high');
  });
});

describe('SubagentConfig.externalInvocation', () => {
  it('attaches externalInvocation to a SubagentConfig', () => {
    const config: SubagentConfig = {
      name: 'cursor-coder',
      description: 'test',
      systemPrompt: 'placeholder',
      level: 'builtin',
      externalInvocation: {
        kind: 'cursor',
        cursorModel: 'default',
        trust: true,
        isolatedCwd: false,
      },
    };
    expect(config.externalInvocation?.kind).toBe('cursor');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run src/subagents/types.test.ts`
Expected: FAIL — `ExternalAgentInvocation` is not exported; `externalInvocation` property does not exist on `SubagentConfig` (type error).

- [ ] **Step 3: Add the type**

In `packages/core/src/subagents/types.ts`, add after the `SubagentConfig` interface (before `SubagentRuntimeConfig`):

```ts
/**
 * Optional external-agent invocation config. When present on a SubagentConfig,
 * the agent tool dispatches to the named external invocation class instead of
 * the in-process AgentHeadless loop. The `kind` discriminant selects the path.
 *
 * `kind: 'cursor'` routes to CursorAgentInvocation, which drives a local
 * @cursor/sdk agent loop and bridges qwen's tool surface in via the SDK's
 * native customTools API.
 */
export interface ExternalAgentInvocation {
  kind: 'cursor';
  /** Cursor model id. 'default' bypasses entitlement budget-exhaustion. */
  cursorModel: string;
  /**
   * Boundary trust gate. Cursor owns its tool loop; qwen policy cannot veto
   * individual in-loop calls. trust:true is the operator consent signal.
   */
  trust: boolean;
  /** When true, run in a throwaway mkdtemp; otherwise inherit parent cwd. */
  isolatedCwd: boolean;
  /** Cursor-native run controls. */
  cursorRun?: {
    sandbox?: { enabled: boolean };
    mode?: string;
    /** Setting sources: ['project'] loads .cursor/rules etc. */
    settingSources?: string[];
  };
  /** Optional model params (reasoning/effort/thinking). */
  modelParams?: {
    reasoning?: string;
    effort?: string;
    thinking?: boolean;
  };
}
```

Then add the field to `SubagentConfig` (add inside the `SubagentConfig` interface, near the other optional fields like `mcpServers?`):

```ts
  /**
   * Optional external-agent invocation. When set, the agent tool dispatches to
   * the named external invocation class (see ExternalAgentInvocation) instead
   * of AgentHeadless. @see ExternalAgentInvocation
   */
  externalInvocation?: ExternalAgentInvocation;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && npx vitest run src/subagents/types.test.ts`
Expected: PASS

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/subagents/types.ts packages/core/src/subagents/types.test.ts
git commit -m "feat(subagents): add ExternalAgentInvocation type for cursor-coder"
```

---

## Task 3: Add `cursor-coder` to `BuiltinAgentRegistry` (gated on `CURSOR_API_KEY`)

**Files:**
- Modify: `packages/core/src/subagents/builtin-agents.ts`
- Modify: `packages/core/src/subagents/builtin-agents.test.ts`

**Interfaces:**
- Consumes: `ExternalAgentInvocation` from Task 2.
- Produces: `BuiltinAgentRegistry.getBuiltinAgents()` includes `cursor-coder` when `CURSOR_API_KEY` is set; elides it when unset.

- [ ] **Step 1: Write the failing test**

Add to `packages/core/src/subagents/builtin-agents.test.ts`:

```ts
describe('cursor-coder builtin', () => {
  it('includes cursor-coder when CURSOR_API_KEY is set', () => {
    const prior = process.env['CURSOR_API_KEY'];
    process.env['CURSOR_API_KEY'] = 'test-key';
    try {
      const agents = BuiltinAgentRegistry.getBuiltinAgents();
      const cursorCoder = agents.find((a) => a.name === 'cursor-coder');
      expect(cursorCoder).toBeDefined();
      expect(cursorCoder?.externalInvocation?.kind).toBe('cursor');
      expect(cursorCoder?.externalInvocation?.cursorModel).toBe('default');
      expect(cursorCoder?.externalInvocation?.trust).toBe(true);
    } finally {
      if (prior === undefined) delete process.env['CURSOR_API_KEY'];
      else process.env['CURSOR_API_KEY'] = prior;
    }
  });

  it('elides cursor-coder when CURSOR_API_KEY is unset', () => {
    const prior = process.env['CURSOR_API_KEY'];
    delete process.env['CURSOR_API_KEY'];
    try {
      const agents = BuiltinAgentRegistry.getBuiltinAgents();
      const cursorCoder = agents.find((a) => a.name === 'cursor-coder');
      expect(cursorCoder).toBeUndefined();
    } finally {
      if (prior !== undefined) process.env['CURSOR_API_KEY'] = prior;
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run src/subagents/builtin-agents.test.ts`
Expected: FAIL — `cursor-coder` not found in the agents list.

- [ ] **Step 3: Add the entry**

The `BUILTIN_AGENTS` static array can't be env-conditional at construction time. Instead, make `getBuiltinAgents()` filter at call time. In `packages/core/src/subagents/builtin-agents.ts`:

3a. Add the cursor-coder config object to the `BUILTIN_AGENTS` array (after `statusline-setup`):

```ts
    {
      name: 'cursor-coder',
      description:
        'A Cursor-SDK-backed coding subagent that drives an external @cursor/sdk agent loop with the full Cursor tool surface (shell/read/edit/write/glob/grep/web) plus qwen first-party tools exposed in-process via the SDK native customTools API. Delegate self-contained coding tasks where you want Cursor loop to drive the change. Cursor runs with sandbox disabled so bridged qwen tools can execute; the trust:true boundary gate at delegation time is the operator consent signal. qwen policy does NOT gate individual tool calls inside the Cursor loop — the only in-loop guards are the agent own user-UID file permissions. Prefer this agent for read-mostly intel tasks over destructive write workflows. Requires CURSOR_API_KEY.',
      systemPrompt:
        'External invocation — cursor SDK drives the loop; this systemPrompt is unused by the SDK.',
      tools: [],
      runConfig: { max_time_minutes: 150, max_turns: 300 },
      externalInvocation: {
        kind: 'cursor',
        cursorModel: 'default',
        trust: true,
        isolatedCwd: false,
        cursorRun: { sandbox: { enabled: false }, settingSources: ['project'] },
      },
    },
```

3b. Modify `getBuiltinAgents()` to env-filter:

```ts
  static getBuiltinAgents(): SubagentConfig[] {
    const all = this.BUILTIN_AGENTS.map((agent) => ({
      ...agent,
      level: 'builtin' as const,
      filePath: `<builtin:${agent.name}>`,
      isBuiltin: true,
    }));
    // Elide cursor-coder when CURSOR_API_KEY is unset.
    if (!process.env['CURSOR_API_KEY']) {
      return all.filter((a) => a.name !== 'cursor-coder');
    }
    return all;
  }
```

3c. Update `isBuiltinAgent` and `getBuiltinAgent` to be consistent — `getBuiltinAgent('cursor-coder')` should return `null` when the env var is unset. Adjust:

```ts
  static getBuiltinAgent(name: string): SubagentConfig | null {
    // Elide cursor-coder when CURSOR_API_KEY is unset.
    if (name === 'cursor-coder' && !process.env['CURSOR_API_KEY']) {
      return null;
    }
    const lowerName = name.toLowerCase();
    const agent = this.BUILTIN_AGENTS.find(
      (a) => a.name.toLowerCase() === lowerName,
    );
    if (!agent) return null;
    return {
      ...agent,
      level: 'builtin' as const,
      filePath: `<builtin:${agent.name}>`,
      isBuiltin: true,
    };
  }
```

3d. `getBuiltinAgentNames()` — similarly filter (or leave unfiltered if it's only used for display; check call sites). If `getBuiltinAgentNames()` is used for the `agent` tool's validation, filter it too:

```ts
  static getBuiltinAgentNames(): string[] {
    const names = this.BUILTIN_AGENTS.map((agent) => agent.name);
    if (!process.env['CURSOR_API_KEY']) {
      return names.filter((n) => n !== 'cursor-coder');
    }
    return names;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && npx vitest run src/subagents/builtin-agents.test.ts`
Expected: PASS (both new tests + existing tests).

- [ ] **Step 5: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: no new errors. (If lint complains about the long description line, that's acceptable — it's a string literal, not code. If it complains about `any`, fix.)

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/subagents/builtin-agents.ts packages/core/src/subagents/builtin-agents.test.ts
git commit -m "feat(subagents): register cursor-coder builtin (gated on CURSOR_API_KEY)"
```

---

## Task 4: Port `cursor-custom-tools.ts` (buildCustomTools)

**Files:**
- Create: `packages/core/src/agents/cursor/cursor-custom-tools.ts`
- Create: `packages/core/src/agents/cursor/cursor-custom-tools.test.ts`

**Interfaces:**
- Consumes: upstream's `ToolRegistry.getAllTools(): AnyDeclarativeTool[]`. Each tool has `name: string`, `description: string`, `schema: FunctionDeclaration` (with `parameters?: Schema`), and `buildAndExecute(params, signal, updateOutput?, shellExecutionConfig?): Promise<ToolResult>`.
- Produces: `buildCustomTools({ registry, exposeBuiltins?, signal? }): Record<string, SDKCustomTool>` where `SDKCustomTool = { description: string; inputSchema: Record<string, SDKJsonValue>; execute: (args) => Promise<SDKCustomToolResult> }`.

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/agents/cursor/cursor-custom-tools.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { buildCustomTools } from './cursor-custom-tools.js';

// Minimal mock of an AnyDeclarativeTool. The real shape is wider; we only
// access name/description/schema/buildAndExecute.
function mockTool(name: string, opts?: { description?: string; schema?: unknown }) {
  return {
    name,
    displayName: name,
    description: opts?.description ?? `Tool ${name}`,
    kind: 0,
    schema: {
      name,
      description: opts?.description ?? `Tool ${name}`,
      parameters: opts?.schema ?? { type: 'object', properties: {} },
    },
    isOutputMarkdown: false,
    canUpdateOutput: false,
    build: vi.fn(() => ({ execute: vi.fn() })),
    buildAndExecute: vi.fn(async () => ({
      llmContent: [{ text: `${name} result` }],
      returnDisplay: `${name} result`,
    })),
  };
}

function mockRegistry(tools: ReturnType<typeof mockTool>[]) {
  return {
    getAllTools: () => tools,
    getTool: (name: string) => tools.find((t) => t.name === name),
  };
}

describe('buildCustomTools', () => {
  it('builds a customTools record from the registry', () => {
    const registry = mockRegistry([
      mockTool('my_tool'),
      mockTool('another_tool'),
    ]);
    const record = buildCustomTools({ registry: registry as any });
    expect(Object.keys(record).sort()).toEqual(['another_tool', 'my_tool']);
    expect(record['my_tool']).toBeDefined();
    expect(typeof record['my_tool'].execute).toBe('function');
  });

  it('excludes overlapping native tool names by default', () => {
    const registry = mockRegistry([
      mockTool('read_file'),
      mockTool('edit'),
      mockTool('run_shell_command'),
      mockTool('my_custom_tool'),
    ]);
    const record = buildCustomTools({ registry: registry as any });
    expect(Object.keys(record)).toEqual(['my_custom_tool']);
  });

  it('includes overlapping native tool names when exposeBuiltins is true', () => {
    const registry = mockRegistry([mockTool('read_file'), mockTool('my_tool')]);
    const record = buildCustomTools({ registry: registry as any, exposeBuiltins: true });
    expect(Object.keys(record).sort()).toEqual(['my_tool', 'read_file']);
  });

  it('execute callback calls buildAndExecute and returns SDKCustomToolResult', async () => {
    const tool = mockTool('my_tool');
    const registry = mockRegistry([tool]);
    const record = buildCustomTools({ registry: registry as any });
    const result = await record['my_tool'].execute({ foo: 'bar' });
    expect(tool.buildAndExecute).toHaveBeenCalledWith(
      { foo: 'bar' },
      undefined,
    );
    expect(result.isError).toBe(false);
    expect(result.content).toEqual([{ type: 'text', text: 'my_tool result' }]);
  });

  it('execute callback returns isError on exception', async () => {
    const tool = mockTool('boom');
    tool.buildAndExecute = vi.fn(async () => {
      throw new Error('kaboom');
    });
    const registry = mockRegistry([tool]);
    const record = buildCustomTools({ registry: registry as any });
    const result = await record['boom'].execute({});
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ type: 'text', text: 'kaboom' });
  });

  it('execute callback returns isError when signal already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const tool = mockTool('my_tool');
    const registry = mockRegistry([tool]);
    const record = buildCustomTools({ registry: registry as any, signal: controller.signal });
    const result = await record['my_tool'].execute({});
    expect(result.isError).toBe(true);
    expect(tool.buildAndExecute).not.toHaveBeenCalled();
  });

  it('CONTROL: empty registry yields empty record (always-passing)', () => {
    const registry = mockRegistry([]);
    const record = buildCustomTools({ registry: registry as any });
    expect(Object.keys(record)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run src/agents/cursor/cursor-custom-tools.test.ts`
Expected: FAIL — module `./cursor-custom-tools.js` not found.

- [ ] **Step 3: Implement `cursor-custom-tools.ts`**

Create `packages/core/src/agents/cursor/cursor-custom-tools.ts`:

```ts
/**
 * @fileoverview In-process custom tools adapter for @cursor/sdk.
 *
 * Replaces the legacy MCP bridge with the SDK's native `customTools` API.
 * Tools are passed directly on `Agent.create({ local: { customTools } })` —
 * the SDK calls our `execute` callback in-process, no loopback HTTP server,
 * no port binding, no auth token, no prefix mangling.
 */

import type {
  SDKCustomTool,
  SDKCustomToolResult,
  SDKJsonValue,
} from '@cursor/sdk';
import { debugLogger } from '../../utils/debugLogger.js';

// Tool names that overlap with Cursor's native tools. Excluded by default to
// avoid double-registration / confusion.
const OVERLAPPING_NATIVE_TOOL_NAMES = new Set([
  'read_file',
  'read_many_files',
  'write_file',
  'edit',
  'run_shell_command',
  'grep_search',
  'glob',
  'find_files',
  'list_directory',
]);

/** Minimal tool shape from upstream's ToolRegistry. */
export interface CursorToolHandle {
  name: string;
  description: string;
  schema: { parameters?: Record<string, unknown> };
  buildAndExecute: (
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<{ llmContent: unknown; error?: { message?: string } }>;
}

/** Minimal registry interface — avoids importing the full ToolRegistry type. */
export interface CursorToolRegistryLike {
  getAllTools(): Iterable<CursorToolHandle>;
}

export interface BuildCustomToolsOptions {
  registry: CursorToolRegistryLike;
  /** Include tools that overlap Cursor's native tools. Default false. */
  exposeBuiltins?: boolean;
  /** AbortSignal for the overall cursor-coder run. */
  signal?: AbortSignal;
}

export function buildCustomTools(
  options: BuildCustomToolsOptions,
): Record<string, SDKCustomTool> {
  const { registry, exposeBuiltins = false, signal } = options;
  const customTools: Record<string, SDKCustomTool> = {};

  for (const tool of registry.getAllTools()) {
    if (!exposeBuiltins && OVERLAPPING_NATIVE_TOOL_NAMES.has(tool.name)) {
      continue;
    }

    const description = tool.description;
    const inputSchema =
      (tool.schema.parameters as Record<string, SDKJsonValue> | undefined) ??
      {};

    customTools[tool.name] = {
      description,
      inputSchema,
      execute: async (
        args: Record<string, SDKJsonValue>,
      ): Promise<SDKCustomToolResult> => {
        if (signal?.aborted) {
          return {
            content: [{ type: 'text', text: 'Run aborted' }],
            isError: true,
          };
        }
        debugLogger.debug(
          `[CursorCustomTools] execute tool=${tool.name} args=${JSON.stringify(args).slice(0, 200)}`,
        );
        try {
          const result = await tool.buildAndExecute(args, signal);
          return {
            content: convertToCustomToolContent(result.llmContent),
            isError: Boolean(result.error),
          };
        } catch (err) {
          return {
            content: [
              {
                type: 'text',
                text: err instanceof Error ? err.message : String(err),
              },
            ],
            isError: true,
          };
        }
      },
    };
  }

  debugLogger.debug(
    `[CursorCustomTools] built ${Object.keys(customTools).length} custom tools`,
  );
  return customTools;
}

function convertToCustomToolContent(
  content: unknown,
): Array<
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType?: string }
> {
  const blocks = Array.isArray(content) ? content : [content];
  const result: Array<
    | { type: 'text'; text: string }
    | { type: 'image'; data: string; mimeType?: string }
  > = [];

  for (const block of blocks) {
    if (typeof block === 'string') {
      result.push({ type: 'text', text: block });
      continue;
    }
    if (block && typeof block === 'object') {
      const rec = block as Record<string, unknown>;
      if (rec['type'] === 'text' && typeof rec['text'] === 'string') {
        result.push({ type: 'text', text: rec['text'] });
        continue;
      }
      if (rec['type'] === 'image' && typeof rec['data'] === 'string') {
        result.push({
          type: 'image',
          data: rec['data'],
          mimeType:
            typeof rec['mimeType'] === 'string' ? rec['mimeType'] : undefined,
        });
        continue;
      }
      const inlineData = rec['inlineData'] as
        | Record<string, unknown>
        | undefined;
      if (
        inlineData &&
        typeof inlineData['data'] === 'string' &&
        typeof inlineData['mimeType'] === 'string'
      ) {
        result.push({
          type: 'image',
          data: inlineData['data'],
          mimeType: inlineData['mimeType'],
        });
        continue;
      }
    }
    result.push({
      type: 'text',
      text: typeof block === 'undefined' ? '' : JSON.stringify(block),
    });
  }

  return result.length > 0 ? result : [{ type: 'text', text: '' }];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && npx vitest run src/agents/cursor/cursor-custom-tools.test.ts`
Expected: PASS (all 7 tests including the CONTROL).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no new errors. (If `SDKCustomTool` / `SDKCustomToolResult` / `SDKJsonValue` are not exported by `@cursor/sdk`, inspect `node_modules/@cursor/sdk/dist/esm/index.d.ts` and adjust the import — the SDK may export them under different names. The structural shapes are what matter.)

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/agents/cursor/cursor-custom-tools.ts packages/core/src/agents/cursor/cursor-custom-tools.test.ts
git commit -m "feat(cursor): port buildCustomTools — native SDK customTools adapter"
```

---

## Task 5: Port `types.ts` — structural SDK type mirrors

**Files:**
- Create: `packages/core/src/agents/cursor/types.ts`

**Interfaces:**
- Produces: structural mirror types for `@cursor/sdk` messages (`CursorSDKMessage` union), `CursorRunResult`, `CursorSdkErrorLike`, `CursorAgentDefinition` (internal — not the registration type), `CursorModelParams`. These let the pure mapper and its tests run WITHOUT the SDK installed.

- [ ] **Step 1: Create the types file**

Create `packages/core/src/agents/cursor/types.ts` with the structural mirrors. Copy the type block from apex-ontap `cursor-invocation.ts` lines ~59-160 (the `CursorTextBlock` / `CursorToolUseBlock` / `CursorContentBlock` / `CursorSystemMessage` / ... / `CursorSDKMessage` union / `CursorRunResult` / `CursorRunResultStatus` / `CursorTokenUsage` / `CursorSdkErrorLike` / `CursorSdkModule` interfaces), plus:

```ts
/** Cursor agent definition (internal — the registration uses SubagentConfig.externalInvocation). */
export interface CursorAgentDefinition {
  kind: 'cursor';
  name: string;
  displayName?: string;
  description: string;
  cursorModel: string;
  trust: boolean;
  isolatedCwd: boolean;
  loadProjectSettings?: boolean;
  cursorRun?: {
    sandbox?: { enabled: boolean };
    mode?: string;
    settingSources?: string[];
    autoReview?: boolean;
  };
  modelParams?: CursorModelParams;
  runConfig?: { maxTimeMinutes?: number; maxTurns?: number };
  resume?: boolean;
}

export interface CursorModelParams {
  reasoning?: string;
  effort?: string;
  thinking?: boolean;
}
```

(See the apex-ontap source for the exact SDK type mirror block — copy verbatim, it's intentionally a structural duplicate so tests don't need the SDK.)

- [ ] **Step 2: Verify it compiles**

Run: `npm run typecheck`
Expected: no errors (the file is type-only, no runtime code to test yet).

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/agents/cursor/types.ts
git commit -m "feat(cursor): add structural SDK type mirrors"
```

---

## Task 6: Port the pure mapper functions (`mapCursorEvent`, `extractAssistantText`, `mapRunResultToOutput`, `applyActivity`)

**Files:**
- Create: `packages/core/src/agents/cursor/cursor-invocation.ts` (mapper section only — the executor comes in Task 9)
- Create: `packages/core/src/agents/cursor/cursor-invocation.test.ts` (mapper tests)
- Create: `packages/core/src/agents/cursor/__fixtures__/cursor-sdk-stream-sample.jsonl`

**Interfaces:**
- Consumes: `CursorSDKMessage` union, `CursorRunResult` from `types.ts` (Task 5); upstream's `AgentTerminateMode` from `agents/runtime/agent-types.ts`.
- Produces: `mapCursorEvent(event, agentName): SubagentActivityEvent[]`, `extractAssistantText(event): string`, `mapRunResultToOutput(result, buffer): OutputObject`, `applyActivity(recentActivity, event): SubagentActivityItem[]`, `resolveCursorApiKey(apiKey?): string | undefined`, `toCursorModelParams(params?): CursorModelParameterValue[] | undefined`, `resolveSettingSources(definition): string[]`.

NOTE: Upstream does not have `SubagentActivityEvent` / `SubagentActivityItem` / `SubagentProgress` / `OutputObject` types — these are fork types. For the port, define minimal local equivalents in `types.ts` (Task 5) OR map directly onto upstream's `AgentEventEmitter` events. Decision: define local `SubagentActivityEvent` / `SubagentActivityItem` types in `types.ts` (they're internal to the cursor invocation's `updateOutput` callback, which receives `ToolResultDisplay`). The `ToolResultDisplay` union includes `AgentResultDisplay` — check if it fits, or use `string`. This is resolved concretely in Step 3 below.

- [ ] **Step 1: Write the failing tests (mapper)**

Create `packages/core/src/agents/cursor/cursor-invocation.test.ts` with tests for each pure function. Use the fixture file for stream-replay tests. Key test cases:

```ts
import { describe, it, expect } from 'vitest';
import {
  mapCursorEvent,
  extractAssistantText,
  mapRunResultToOutput,
  applyActivity,
  resolveCursorApiKey,
  toCursorModelParams,
} from './cursor-invocation.js';
import { AgentTerminateMode } from '../../agents/runtime/agent-types.js';

describe('mapCursorEvent', () => {
  it('maps a thinking message to a THOUGHT_CHUNK event', () => {
    const events = mapCursorEvent(
      { type: 'thinking', agent_id: 'a', run_id: 'r', text: 'hello' },
      'cursor-coder',
    );
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('THOUGHT_CHUNK');
    expect(events[0].data['text']).toBe('hello');
  });

  it('maps an assistant tool_use block to a TOOL_CALL_START event', () => {
    const events = mapCursorEvent(
      {
        type: 'assistant',
        agent_id: 'a',
        run_id: 'r',
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'call1', name: 'shell', input: {} }],
        },
      },
      'cursor-coder',
    );
    expect(events[0].type).toBe('TOOL_CALL_START');
    expect(events[0].data['callId']).toBe('call1');
  });

  it('maps a tool_call(running) to TOOL_CALL_START', () => {
    const events = mapCursorEvent(
      { type: 'tool_call', agent_id: 'a', run_id: 'r', call_id: 'c1', name: 'read', status: 'running' },
      'cursor-coder',
    );
    expect(events[0].type).toBe('TOOL_CALL_START');
  });

  it('maps a tool_call(completed) to TOOL_CALL_END', () => {
    const events = mapCursorEvent(
      { type: 'tool_call', agent_id: 'a', run_id: 'r', call_id: 'c1', name: 'read', status: 'completed' },
      'cursor-coder',
    );
    expect(events[0].type).toBe('TOOL_CALL_END');
  });

  it('maps a status(ERROR) to an ERROR event', () => {
    const events = mapCursorEvent(
      { type: 'status', agent_id: 'a', run_id: 'r', status: 'ERROR', message: 'boom' },
      'cursor-coder',
    );
    expect(events[0].type).toBe('ERROR');
  });

  it('maps a request (approval) to auto-denied PERMISSION_GATE pair', () => {
    const events = mapCursorEvent(
      { type: 'request', agent_id: 'a', run_id: 'r', request_id: 'req1' },
      'cursor-coder',
    );
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('PERMISSION_GATE');
    expect(events[0].data['phase']).toBe('request');
    expect(events[1].data['phase']).toBe('response');
    expect(events[1].data['approved']).toBe(false);
  });

  it('returns [] for system/user/task messages', () => {
    for (const msg of [
      { type: 'system', agent_id: 'a', run_id: 'r' },
      { type: 'user', agent_id: 'a', run_id: 'r', message: { role: 'user', content: [] } },
      { type: 'task', agent_id: 'a', run_id: 'r' },
    ]) {
      expect(mapCursorEvent(msg as any, 'cursor-coder')).toEqual([]);
    }
  });

  it('CONTROL: empty thinking text yields no event (always-passing)', () => {
    expect(mapCursorEvent({ type: 'thinking', agent_id: 'a', run_id: 'r', text: '' }, 'cursor-coder')).toEqual([]);
  });
});

describe('extractAssistantText', () => {
  it('concatenates text blocks from an assistant message', () => {
    const text = extractAssistantText({
      type: 'assistant',
      agent_id: 'a',
      run_id: 'r',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'hello ' },
          { type: 'text', text: 'world' },
        ],
      },
    });
    expect(text).toBe('hello world');
  });

  it('returns "" for non-assistant messages', () => {
    expect(extractAssistantText({ type: 'thinking', agent_id: 'a', run_id: 'r', text: 'x' } as any)).toBe('');
  });
});

describe('mapRunResultToOutput', () => {
  it('finished → GOAL', () => {
    const out = mapRunResultToOutput({ id: 'r', status: 'finished', result: 'done' }, '');
    expect(out.terminate_reason).toBe(AgentTerminateMode.GOAL);
    expect(out.result).toBe('done');
  });

  it('cancelled → ABORTED', () => {
    const out = mapRunResultToOutput({ id: 'r', status: 'cancelled' }, 'partial buffer');
    expect(out.terminate_reason).toBe(AgentTerminateMode.ABORTED);
  });

  it('error with result → ERROR + result', () => {
    const out = mapRunResultToOutput({ id: 'r', status: 'error', result: 'SDK failed' }, '');
    expect(out.terminate_reason).toBe(AgentTerminateMode.ERROR);
    expect(out.result).toBe('SDK failed');
  });

  it('error without result → ERROR + "no machine-readable reason" marker', () => {
    const out = mapRunResultToOutput({ id: 'r', status: 'error' }, 'last assistant text');
    expect(out.terminate_reason).toBe(AgentTerminateMode.ERROR);
    expect(out.result).toContain('no result');
    expect(out.result).toContain('Last assistant text');
  });
});

describe('resolveCursorApiKey', () => {
  it('explicit arg wins', () => {
    expect(resolveCursorApiKey('explicit-key')).toBe('explicit-key');
  });

  it('falls through to env var', () => {
    const prior = process.env['CURSOR_API_KEY'];
    process.env['CURSOR_API_KEY'] = 'env-key';
    try {
      expect(resolveCursorApiKey()).toBe('env-key');
    } finally {
      if (prior === undefined) delete process.env['CURSOR_API_KEY'];
      else process.env['CURSOR_API_KEY'] = prior;
    }
  });

  it('returns undefined when nothing set', () => {
    const prior = process.env['CURSOR_API_KEY'];
    delete process.env['CURSOR_API_KEY'];
    try {
      expect(resolveCursorApiKey()).toBeUndefined();
    } finally {
      if (prior !== undefined) process.env['CURSOR_API_KEY'] = prior;
    }
  });

  it('placeholder values fall through to env', () => {
    const prior = process.env['CURSOR_API_KEY'];
    process.env['CURSOR_API_KEY'] = 'env-key';
    try {
      expect(resolveCursorApiKey('$CURSOR_API_KEY')).toBe('env-key');
    } finally {
      if (prior === undefined) delete process.env['CURSOR_API_KEY'];
      else process.env['CURSOR_API_KEY'] = prior;
    }
  });
});

describe('toCursorModelParams', () => {
  it('returns undefined for no params', () => {
    expect(toCursorModelParams(undefined)).toBeUndefined();
  });

  it('emits reasoning/effort/thinking', () => {
    const out = toCursorModelParams({ reasoning: 'high', effort: 'medium', thinking: true });
    expect(out).toEqual([
      { id: 'reasoning', value: 'high' },
      { id: 'effort', value: 'medium' },
      { id: 'thinking', value: 'true' },
    ]);
  });

  it('omits effort when thinking is false', () => {
    const out = toCursorModelParams({ effort: 'medium', thinking: false });
    expect(out).toEqual([{ id: 'thinking', value: 'false' }]);
  });
});

describe('applyActivity', () => {
  it('merges consecutive THOUGHT_CHUNKs into one running thought', () => {
    let activity: any[] = [];
    activity = applyActivity(activity, { isSubagentActivityEvent: true, agentName: 'a', type: 'THOUGHT_CHUNK', data: { text: 'foo' } });
    activity = applyActivity(activity, { isSubagentActivityEvent: true, agentName: 'a', type: 'THOUGHT_CHUNK', data: { text: 'bar' } });
    expect(activity).toHaveLength(1);
    expect(activity[0].content).toBe('foobar');
  });

  it('dedupes TOOL_CALL_START by callId', () => {
    let activity: any[] = [];
    const ev = { isSubagentActivityEvent: true, agentName: 'a', type: 'TOOL_CALL_START', data: { callId: 'c1', name: 'shell', args: {} } };
    activity = applyActivity(activity, ev);
    activity = applyActivity(activity, ev);
    expect(activity.filter((i) => i.type === 'tool_call')).toHaveLength(1);
  });

  it('marks a running tool_call as completed on TOOL_CALL_END', () => {
    let activity: any[] = [];
    activity = applyActivity(activity, { isSubagentActivityEvent: true, agentName: 'a', type: 'TOOL_CALL_START', data: { callId: 'c1', name: 'shell', args: {} } });
    activity = applyActivity(activity, { isSubagentActivityEvent: true, agentName: 'a', type: 'TOOL_CALL_END', data: { callId: 'c1', isError: false } });
    expect(activity[0].status).toBe('completed');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && npx vitest run src/agents/cursor/cursor-invocation.test.ts`
Expected: FAIL — module not found / functions not exported.

- [ ] **Step 3: Implement the mapper functions**

Create `packages/core/src/agents/cursor/cursor-invocation.ts` with ONLY the pure functions (the executor class comes in Task 9). Port from apex-ontap `cursor-invocation.ts`:
- `mapCursorEvent` (including the `PERMISSION_GATE` handling for `request` and `interaction_query` messages)
- `extractAssistantText`
- `mapRunResultToOutput`
- `applyActivity` (including `THOUGHT_CHUNK`, `TOOL_CALL_START`, `TOOL_CALL_END`, `ERROR`, `PERMISSION_GATE` cases)
- `resolveCursorApiKey`
- `toCursorModelParams`
- `resolveSettingSources`
- `canonicalSdkToolName`, `refineEditNameOnComplete` (display-name helpers)
- `MAX_RECENT_ACTIVITY` constant

**DO NOT** port: `CursorAgentInvocation` class, `ensureCursorH1Config`, `CursorToolBridgeRegistry` usage, curl shim, `APEX_CURSOR_HTTPS_PROXY` env scoping, `toCursorMcpServers` (dead on customTools path).

For the `SubagentActivityEvent` / `SubagentActivityItem` / `OutputObject` types: add them to `types.ts` (Task 5 file — edit it). They're internal to the cursor invocation's `updateOutput` flow. Define:

```ts
// In types.ts (add):
export interface SubagentActivityEvent {
  isSubagentActivityEvent: true;
  agentName: string;
  type:
    | 'THOUGHT_CHUNK'
    | 'TOOL_CALL_START'
    | 'TOOL_CALL_END'
    | 'ERROR'
    | 'PERMISSION_GATE';
  data: Record<string, unknown>;
}

export interface SubagentActivityItem {
  id: string;
  type: 'thought' | 'tool_call';
  content: string;
  args?: string;
  status: 'running' | 'completed' | 'error' | 'cancelled';
}

export interface OutputObject {
  result: string;
  terminate_reason: import('../../agents/runtime/agent-types.js').AgentTerminateMode;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/core && npx vitest run src/agents/cursor/cursor-invocation.test.ts`
Expected: PASS (all tests including CONTROL).

- [ ] **Step 5: Stash-and-rerun check**

```bash
git stash
cd packages/core && npx vitest run src/agents/cursor/cursor-invocation.test.ts
# capture: tests FAIL (module not found) — pre-existing state confirmed
git stash pop
cd packages/core && npx vitest run src/agents/cursor/cursor-invocation.test.ts
# capture: tests PASS — GREEN caused by the implementation
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/agents/cursor/cursor-invocation.ts packages/core/src/agents/cursor/cursor-invocation.test.ts packages/core/src/agents/cursor/types.ts
git commit -m "feat(cursor): port pure mapper functions (mapCursorEvent, applyActivity, etc.)"
```

---

## Task 7: Port `cursor-sdk-output-suppression.ts`

**Files:**
- Create: `packages/core/src/agents/cursor/cursor-sdk-output-suppression.ts`
- Create: `packages/core/src/agents/cursor/cursor-sdk-output-suppression.test.ts`

**Interfaces:**
- Produces: `CursorSdkOutputSuppressor` class with `install()`, `uninstall()`, `runStartupScope(fn)`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run src/agents/cursor/cursor-sdk-output-suppression.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Port `cursor-sdk-output-suppression.ts` from apex-ontap verbatim (it's self-contained — stdout/stderr/console suppression during SDK startup). The apex-ontap version is ~120 lines. Copy the structure: `install()` monkeypatches `process.stdout.write` / `process.stderr.write` / `console.log`/`error`/`warn` to no-op (or buffer), `uninstall()` restores, `runStartupScope(fn)` installs → awaits fn → uninstalls in finally.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && npx vitest run src/agents/cursor/cursor-sdk-output-suppression.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/agents/cursor/cursor-sdk-output-suppression.ts packages/core/src/agents/cursor/cursor-sdk-output-suppression.test.ts
git commit -m "feat(cursor): port CursorSdkOutputSuppressor"
```

---

## Task 8: Port `run-timeout.ts` (minimal `withRunTimeout`)

**Files:**
- Create: `packages/core/src/agents/cursor/run-timeout.ts`
- Create: `packages/core/src/agents/cursor/run-timeout.test.ts`

**Interfaces:**
- Produces: `withRunTimeout(fn, maxMinutes?, onTimeout?): Promise<T>`, `CliRunTimeoutError` class, `isCliRunTimeoutError(e): boolean`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { withRunTimeout, CliRunTimeoutError, isCliRunTimeoutError } from './run-timeout.js';

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run src/agents/cursor/run-timeout.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `packages/core/src/agents/cursor/run-timeout.ts`. Port a minimal version of apex-ontap's `cli-timeout.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && npx vitest run src/agents/cursor/run-timeout.test.ts`
Expected: PASS (all 5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/agents/cursor/run-timeout.ts packages/core/src/agents/cursor/run-timeout.test.ts
git commit -m "feat(cursor): port withRunTimeout helper"
```

---

## Task 9: Port `cursor-mcp-timeout-override.ts`

**Files:**
- Create: `packages/core/src/agents/cursor/cursor-mcp-timeout-override.ts`
- Create: `packages/core/src/agents/cursor/cursor-mcp-timeout-override.test.ts`

**Interfaces:**
- Produces: `installCursorMcpToolTimeoutOverride()`, `restoreCursorMcpToolTimeoutOverride()`.

- [ ] **Step 1: Write the failing test**

Port the test from apex-ontap `cursor-mcp-timeout-override.test.ts`. Key cases:
- `install()` monkeypatches setTimeout (or the SDK's MCP timeout)
- `restore()` reverts
- default-timeout detection
- stack-classification helpers (`isCursorSdkMcpToolTimeoutStack`, etc.) if they exist

```ts
import { describe, it, expect } from 'vitest';
import {
  installCursorMcpToolTimeoutOverride,
  restoreCursorMcpToolTimeoutOverride,
} from './cursor-mcp-timeout-override.js';

describe('cursor-mcp-timeout-override', () => {
  it('install/restore are idempotent', () => {
    expect(() => installCursorMcpToolTimeoutOverride()).not.toThrow();
    expect(() => installCursorMcpToolTimeoutOverride()).not.toThrow();
    expect(() => restoreCursorMcpToolTimeoutOverride()).not.toThrow();
    expect(() => restoreCursorMcpToolTimeoutOverride()).not.toThrow();
  });

  it('CONTROL: install then restore round-trips (always-passing)', () => {
    installCursorMcpToolTimeoutOverride();
    restoreCursorMcpToolTimeoutOverride();
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run src/agents/cursor/cursor-mcp-timeout-override.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Port from apex-ontap `cursor-mcp-timeout-override.ts`. This module bounds the SDK's MCP connect/tool-call timers by monkeypatching setTimeout when the stack matches the SDK's MCP protocol path. ~68 lines. Copy the structure; adapt env-var names if any (`APEX_*` → `QWEN_*`).

**Implementation note:** with `customTools` (no bridge cold-start), this override is less critical but still bounds any external `mcpServers` the operator configures. Keep it; verify relevance during implementation. If the override proves irrelevant with customTools (no SDK MCP paths to bound), simplify to a no-op install/restore and document why.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && npx vitest run src/agents/cursor/cursor-mcp-timeout-override.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/agents/cursor/cursor-mcp-timeout-override.ts packages/core/src/agents/cursor/cursor-mcp-timeout-override.test.ts
git commit -m "feat(cursor): port MCP timeout override"
```

---

## Task 10: Port `CursorAgentInvocation` (the executor)

**Files:**
- Modify: `packages/core/src/agents/cursor/cursor-invocation.ts` (add the class — the pure functions are already there from Task 6)
- Modify: `packages/core/src/agents/cursor/cursor-invocation.test.ts` (add executor tests — fixture replay)

**Interfaces:**
- Consumes: `BaseToolInvocation` from `../../tools/tools.js`; `CursorAgentDefinition`, `CursorSDKMessage`, `CursorRunResult` from `./types.js`; `buildCustomTools` from `./cursor-custom-tools.js`; `CursorSdkOutputSuppressor` from `./cursor-sdk-output-suppression.js`; `withRunTimeout` from `./run-timeout.js`; upstream `Config` + `ToolRegistry`.
- Produces: `CursorAgentInvocation extends BaseToolInvocation<{ query: string }, ToolResult>` with `execute(signal, updateOutput?): Promise<ToolResult>`.

- [ ] **Step 1: Write the failing test (fixture replay)**

Add to `packages/core/src/agents/cursor/cursor-invocation.test.ts`:

```ts
import { vi } from 'vitest';
import { CursorAgentInvocation } from './cursor-invocation.js';

// Mock the @cursor/sdk lazy import. The invocation does `await import('@cursor/sdk')`.
vi.mock('@cursor/sdk', () => {
  const mockRun = {
    id: 'run-1',
    stream: async function* () {
      // Yield a minimal recorded stream: thinking → assistant text → tool_call → status(finished)
      yield { type: 'thinking', agent_id: 'a', run_id: 'run-1', text: 'Planning...' };
      yield {
        type: 'assistant',
        agent_id: 'a',
        run_id: 'run-1',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] },
      };
      yield { type: 'status', agent_id: 'a', run_id: 'run-1', status: 'FINISHED' };
    },
    wait: async () => ({ id: 'run-1', status: 'finished', result: 'Task complete.' }),
    cancel: async () => {},
    supports: (cap: string) => cap === 'cancel',
  };
  return {
    Agent: {
      create: vi.fn(async () => ({
        agentId: 'agent-1',
        send: vi.fn(async () => mockRun),
        close: vi.fn(),
      })),
      resume: vi.fn(async () => ({
        agentId: 'agent-1',
        send: vi.fn(async () => mockRun),
        close: vi.fn(),
      })),
    },
    CursorSdkError: class extends Error {},
  };
});

describe('CursorAgentInvocation.execute', () => {
  it('drives the SDK loop and returns a ToolResult', async () => {
    const prior = process.env['CURSOR_API_KEY'];
    process.env['CURSOR_API_KEY'] = 'test-key';
    try {
      const definition = {
        kind: 'cursor' as const,
        name: 'cursor-coder',
        cursorModel: 'default',
        trust: true,
        isolatedCwd: false,
        runConfig: { maxTimeMinutes: 1, maxTurns: 10 },
      };
      const context = {
        config: { getProjectRoot: () => '/tmp/test', getToolRegistry: () => ({ getAllTools: () => [] }) },
      };
      const invocation = new CursorAgentInvocation(
        definition as any,
        context as any,
        { query: 'do the thing' },
      );
      const result = await invocation.execute(new AbortController().signal);
      expect(result.llmContent).toBeDefined();
      expect(result.returnDisplay).toBeDefined();
    } finally {
      if (prior === undefined) delete process.env['CURSOR_API_KEY'];
      else process.env['CURSOR_API_KEY'] = prior;
    }
  });

  it('refuses to run when trust is false', async () => {
    const prior = process.env['CURSOR_API_KEY'];
    process.env['CURSOR_API_KEY'] = 'test-key';
    try {
      const definition = {
        kind: 'cursor' as const,
        name: 'cursor-coder',
        cursorModel: 'default',
        trust: false,
        isolatedCwd: false,
      };
      const context = {
        config: { getProjectRoot: () => '/tmp/test', getToolRegistry: () => ({ getAllTools: () => [] }) },
      };
      const invocation = new CursorAgentInvocation(
        definition as any,
        context as any,
        { query: 'do the thing' },
      );
      const result = await invocation.execute(new AbortController().signal);
      expect(result.error).toBeDefined();
    } finally {
      if (prior === undefined) delete process.env['CURSOR_API_KEY'];
      else process.env['CURSOR_API_KEY'] = prior;
    }
  });

  it('throws when CURSOR_API_KEY is unset', async () => {
    const prior = process.env['CURSOR_API_KEY'];
    delete process.env['CURSOR_API_KEY'];
    try {
      const definition = {
        kind: 'cursor' as const,
        name: 'cursor-coder',
        cursorModel: 'default',
        trust: true,
        isolatedCwd: false,
      };
      const context = {
        config: { getProjectRoot: () => '/tmp/test', getToolRegistry: () => ({ getAllTools: () => [] }) },
      };
      const invocation = new CursorAgentInvocation(
        definition as any,
        context as any,
        { query: 'do the thing' },
      );
      const result = await invocation.execute(new AbortController().signal);
      expect(result.error).toBeDefined();
      expect(JSON.stringify(result.llmContent)).toContain('CURSOR_API_KEY');
    } finally {
      if (prior !== undefined) process.env['CURSOR_API_KEY'] = prior;
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run src/agents/cursor/cursor-invocation.test.ts`
Expected: FAIL — `CursorAgentInvocation` not exported.

- [ ] **Step 3: Implement the executor class**

Add to `packages/core/src/agents/cursor/cursor-invocation.ts`. Port the `CursorAgentInvocation` class from apex-ontap `cursor-invocation.ts`, with these adaptations:

**Constructor:** upstream's `BaseToolInvocation<TParams, TResult>` constructor takes only `params`. The fork's takes `(definition, context, params, messageBus, toolName?, toolDisplayName?)`. Adapt:

```ts
export class CursorAgentInvocation extends BaseToolInvocation<
  { query: string },
  ToolResult
> {
  private static readonly sessionState = new Map<string, string>();

  constructor(
    private readonly definition: CursorAgentDefinition,
    private readonly context: { config: Config; toolRegistry: CursorToolRegistryLike },
    params: { query: string },
  ) {
    super(params);
  }
  // ...
}
```

**execute signature:** upstream's is `execute(signal: AbortSignal, updateOutput?: (output: ToolResultDisplay) => void, shellExecutionConfig?: ShellExecutionConfig): Promise<ToolResult>`. The fork's is `execute(options: ExecuteOptions): Promise<ToolResult>` where `ExecuteOptions = { abortSignal, updateOutput }`. Adapt to upstream's signature: `execute(signal, updateOutput?)`.

**`getConfirmationDetails`:** upstream's `BaseToolInvocation.getConfirmationDetails` returns `Promise<ToolCallConfirmationDetails>`. Override it to return the boundary-confirmation info card (ported from apex-ontap).

**Create options:** port the `Agent.create({ apiKey, model, local: { cwd, settingSources, sandboxOptions, useHttp1ForAgent: true, customTools }, mcpServers: {} })` construction. Use `buildCustomTools({ registry: context.toolRegistry, signal })` for the customTools record. Pass `mcpServers: {}` to suppress disk discovery.

**Stream loop:** port the `run.stream()` for-await loop — `extractAssistantText`, `emit(mapCursorEvent(...))`, logical-turn counting, `PERMISSION_GATE` handling, stream-trace (optional, gated on `QWEN_CURSOR_STREAM_TRACE` env var).

**`run.wait()` + `CursorSdkError` distinction:** port the try/catch that distinguishes a thrown `CursorSdkError` (transport/auth failure) from a returned `RunResult{status:'error'}` (model-loop error).

**Timeout:** wrap the stream loop in `withRunTimeout(fn, definition.runConfig?.maxTimeMinutes, () => cancelRunSafely(activeRun))`.

**`mapRunResultToOutput` + final `ToolResult`:** port the final assembly. Return `{ llmContent: [{ text: ... }], returnDisplay: <ToolResultDisplay> }`. For `returnDisplay`, use a `string` or `AgentResultDisplay` — check which fits upstream's `ToolResultDisplay` union. If neither fits cleanly, use a `string` summary.

**Strip (do NOT port):**
- `CursorToolBridgeRegistry` / `toolBridge.enabled` branch (customTools is the only path)
- `ensureCursorH1Config`
- `APEX_CURSOR_HTTPS_PROXY` env scoping / `restoreProxyEnv`
- curl shim / `globalThis.fetch` patch / `priorFetch`
- `spawn` import
- `toCursorMcpServers` (dead on customTools path)
- `inheritSpectreMcpServers` / `inheritAllApexMcpServers`

**Env var rebrand:** `APEX_CURSOR_STREAM_TRACE` → `QWEN_CURSOR_STREAM_TRACE`; `APEX_CURSOR_BRIDGE_DEBUG` → `QWEN_CURSOR_DEBUG` (bridge is gone, but keep a general debug env var if useful).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/core && npx vitest run src/agents/cursor/cursor-invocation.test.ts`
Expected: PASS (mapper tests from Task 6 + executor tests).

- [ ] **Step 5: Stash-and-rerun check**

```bash
git stash
cd packages/core && npx vitest run src/agents/cursor/cursor-invocation.test.ts
# capture: executor tests FAIL (class not exported); mapper tests may also fail if they're in the same file
git stash pop
cd packages/core && npx vitest run src/agents/cursor/cursor-invocation.test.ts
# capture: PASS
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors. (Watch for: `ToolResultDisplay` union compatibility, `Config` interface accessors, `BaseToolInvocation` abstract method compliance.)

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/agents/cursor/cursor-invocation.ts packages/core/src/agents/cursor/cursor-invocation.test.ts
git commit -m "feat(cursor): port CursorAgentInvocation executor (customTools path)"
```

---

## Task 11: Add the `index.ts` barrel + create the fixture file

**Files:**
- Create: `packages/core/src/agents/cursor/index.ts`
- Create: `packages/core/src/agents/cursor/__fixtures__/cursor-sdk-stream-sample.jsonl`

- [ ] **Step 1: Create `index.ts`**

```ts
export { CursorAgentInvocation } from './cursor-invocation.js';
export {
  mapCursorEvent,
  extractAssistantText,
  mapRunResultToOutput,
  applyActivity,
  resolveCursorApiKey,
  toCursorModelParams,
  resolveSettingSources,
} from './cursor-invocation.js';
export { buildCustomTools } from './cursor-custom-tools.js';
export { CursorSdkOutputSuppressor } from './cursor-sdk-output-suppression.js';
export {
  installCursorMcpToolTimeoutOverride,
  restoreCursorMcpToolTimeoutOverride,
} from './cursor-mcp-timeout-override.js';
export { withRunTimeout, CliRunTimeoutError, isCliRunTimeoutError } from './run-timeout.js';
export type {
  CursorAgentDefinition,
  CursorModelParams,
  CursorSDKMessage,
  CursorRunResult,
  SubagentActivityEvent,
  SubagentActivityItem,
  OutputObject,
} from './types.js';
```

- [ ] **Step 2: Create the fixture file**

Copy the fixture from apex-ontap `packages/core/src/agents/__fixtures__/cursor-cli-stream-sample.jsonl` to `packages/core/src/agents/cursor/__fixtures__/cursor-sdk-stream-sample.jsonl`. This is a recorded SDK message stream (one JSON object per line) used by the mapper fixture-replay tests.

If the apex-ontap fixture is a CLI-stream format (not SDK), record a fresh SDK fixture by running a real cursor-coder delegation with `QWEN_CURSOR_STREAM_TRACE=...` and capturing the trace. If that's not feasible during implementation, use a hand-crafted minimal fixture covering: system/init, thinking, assistant(text), assistant(tool_use), tool_call(running), tool_call(completed), status(FINISHED).

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/agents/cursor/index.ts packages/core/src/agents/cursor/__fixtures__/
git commit -m "feat(cursor): add index barrel + stream fixture"
```

---

## Task 12: Add the dispatch hook in `tools/agent/agent.ts`

**Files:**
- Modify: `packages/core/src/tools/agent/agent.ts`
- Modify: `packages/core/src/tools/agent/agent.test.ts`

**Interfaces:**
- Consumes: `CursorAgentInvocation` from `../../agents/cursor/index.js`; `ExternalAgentInvocation` from `../../subagents/types.js`.
- Produces: when a resolved `SubagentConfig` has `externalInvocation?.kind === 'cursor'`, the `agent` tool constructs `CursorAgentInvocation` and runs it via `execute(signal, updateOutput)` instead of spawning `AgentHeadless`.

- [ ] **Step 1: Write the failing test**

Add to `packages/core/src/tools/agent/agent.test.ts`:

```ts
import { vi } from 'vitest';

describe('AgentTool dispatch hook — externalInvocation', () => {
  it('routes cursor externalInvocation to CursorAgentInvocation (not AgentHeadless)', async () => {
    // Mock CursorAgentInvocation so we can assert it's called.
    const mockExecute = vi.fn(async (_signal: AbortSignal) => ({
      llmContent: [{ text: 'cursor ran' }],
      returnDisplay: 'cursor ran',
    }));
    vi.mock('../../agents/cursor/index.js', () => ({
      CursorAgentInvocation: vi.fn(function (this: any, definition: any, context: any, params: any) {
        this.params = params;
        this.execute = mockExecute;
      }),
    }));

    const prior = process.env['CURSOR_API_KEY'];
    process.env['CURSOR_API_KEY'] = 'test-key';
    try {
      // Build a minimal Config + AgentTool; resolve a cursor-coder subagent_type.
      // Assert mockExecute is called (not AgentHeadless).
      // (Exact setup depends on the existing test harness in agent.test.ts —
      // mirror the existing subagent-dispatch test pattern.)
      // ...
      expect(mockExecute).toHaveBeenCalled();
    } finally {
      if (prior === undefined) delete process.env['CURSOR_API_KEY'];
      else process.env['CURSOR_API_KEY'] = prior;
    }
    vi.restoreAllMocks();
  });

  it('routes non-external configs to AgentHeadless (unchanged)', async () => {
    // Assert that a general-purpose subagent_type still goes through AgentHeadless.
    // (Mirror the existing dispatch test; assert CursorAgentInvocation is NOT called.)
  });
});
```

(The exact harness setup depends on the existing `agent.test.ts` patterns — mirror them. The key assertion: `CursorAgentInvocation.execute` is called for `cursor-coder`, and NOT called for `general-purpose`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run src/tools/agent/agent.test.ts`
Expected: FAIL — the dispatch hook doesn't exist; `cursor-coder` either isn't found or goes through `AgentHeadless`.

- [ ] **Step 3: Implement the hook**

In `packages/core/src/tools/agent/agent.ts`, find the dispatch path where `SubagentConfig` is resolved and `AgentHeadless` is spawned. Add a branch BEFORE the `AgentHeadless` spawn:

```ts
// After resolving the SubagentConfig for the requested subagent_type:
const externalInvocation = resolvedConfig.externalInvocation;
if (externalInvocation?.kind === 'cursor') {
  const { CursorAgentInvocation } = await import('../../agents/cursor/index.js');
  const definition: CursorAgentDefinition = {
    kind: 'cursor',
    name: resolvedConfig.name,
    description: resolvedConfig.description,
    cursorModel: externalInvocation.cursorModel,
    trust: externalInvocation.trust,
    isolatedCwd: externalInvocation.isolatedCwd,
    cursorRun: externalInvocation.cursorRun,
    modelParams: externalInvocation.modelParams,
    runConfig: resolvedConfig.runConfig
      ? {
          maxTimeMinutes: resolvedConfig.runConfig.max_time_minutes,
          maxTurns: resolvedConfig.runConfig.max_turns,
        }
      : undefined,
  };
  const invocation = new CursorAgentInvocation(
    definition,
    { config: this.config, toolRegistry: this.config.getToolRegistry() },
    { query: params.prompt },
  );
  const result = await invocation.execute(abortSignal, updateOutput);
  return result;
}
// ... existing AgentHeadless spawn path unchanged
```

(The exact insertion point and variable names depend on the existing dispatch code — read the surrounding context in `agent.ts` and match it. The hook is ~15 lines.)

**Important:** the `query` input — the `agent` tool's `params.prompt` is the task prompt. The `CursorAgentInvocation` expects `{ query: string }`. Map `params.prompt` → `query`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && npx vitest run src/tools/agent/agent.test.ts`
Expected: PASS (new tests + existing tests).

- [ ] **Step 5: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/tools/agent/agent.ts packages/core/src/tools/agent/agent.test.ts
git commit -m "feat(agent): dispatch hook routes externalInvocation.cursor to CursorAgentInvocation"
```

---

## Task 13: Full build + typecheck + lint + test sweep

**Files:** None (verification only).

- [ ] **Step 1: Build**

Run: `npm run build`
Expected: all packages compile. No errors.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: no new errors. (Pre-existing lint issues in unrelated files are not this PR's concern.)

- [ ] **Step 4: Run all cursor tests**

Run: `cd packages/core && npx vitest run src/agents/cursor/`
Expected: all PASS.

- [ ] **Step 5: Run subagents tests**

Run: `cd packages/core && npx vitest run src/subagents/`
Expected: all PASS (including the new cursor-coder entry tests).

- [ ] **Step 6: Run agent tool tests**

Run: `cd packages/core && npx vitest run src/tools/agent/`
Expected: all PASS (including the new dispatch-hook test).

- [ ] **Step 7: Commit (if any fixups were needed)**

If Steps 1-6 required fixups, commit them:
```bash
git add -A
git commit -m "fix(cursor): build/typecheck/lint sweep fixups"
```

---

## Task 14: Self-audit — read the full diff

**Files:** None (audit only).

- [ ] **Step 1: Read the full diff against the base branch**

```bash
git diff dogfood-2026-08-12...HEAD
```

Read every changed file. For each:
- Does it match the spec's intent?
- Is there fork-specific coupling (apex, spectre, APEX_*) that should be rebranded or dropped?
- Are there comments that narrate *what* instead of *why*? Remove the *what* comments.
- Are there any `TODO` / `TBD` / placeholder strings left? Fix them.

- [ ] **Step 2: Verify each green test isn't asserting the wrong thing**

For each test file, read the assertions. Ask: "Could a degenerate implementation (e.g., always-return-success) pass this test?" If yes, add a CONTROL test or tighten the assertion. The CONTROL tests (empty-registry, zero-duration, empty-thinking-text) are already in place — verify they're meaningful.

- [ ] **Step 3: Two consecutive clean passes**

Re-run `npm run build && npm run typecheck && cd packages/core && npx vitest run src/agents/cursor/ src/subagents/ src/tools/agent/` twice. Both must be fully green with no fixups between. If a fixup is needed, reset the clean-pass count.

- [ ] **Step 4: Commit any audit fixups**

```bash
git add -A
git commit -m "chore(cursor): self-audit fixups"
```

---

## Task 15: PR preparation

**Files:**
- Create or update: PR description (use `.github/pull_request_template.md`)

- [ ] **Step 1: Verify the worktree branch is clean**

```bash
git status
git log --oneline dogfood-2026-08-12..HEAD
```

All changes committed; no uncommitted files.

- [ ] **Step 2: Run preflight (optional but recommended)**

Run: `npm run preflight` (if time permits — it's the full clean → install → format → lint → build → typecheck → test sweep)

- [ ] **Step 3: Draft the PR description**

Follow `.github/pull_request_template.md`. Key points for the description:
- **Motivation:** Cursor-SDK-backed coding subagent; native `customTools` tool bridging; default-off (`CURSOR_API_KEY`).
- **Changes:** New `packages/core/src/agents/cursor/` module; `externalInvocation` discriminant on `SubagentConfig`; `cursor-coder` in `BuiltinAgentRegistry`; dispatch hook in `agent.ts`.
- **Reviewer Test Plan:** set `CURSOR_API_KEY`, run `qwen`, verify `cursor-coder` appears in `/agents`, delegate a task via the `agent` tool, verify the cursor SDK loop runs and returns a result.
- **Before/After:** `/agents` list (cursor-coder absent → present when key set).

- [ ] **Step 4: Do NOT push or create the PR yet**

Present the branch for review. The user decides when to push / create the PR.

---

## Summary

| Task | Gate | RED-before-GREEN | CONTROL test |
|---|---|---|---|
| 1 | Dependency | — | — |
| 2 | Types | ✅ | — |
| 3 | Registration | ✅ | — |
| 4 | customTools | ✅ | empty-registry |
| 5 | Types (SDK mirrors) | — | — |
| 6 | Pure mapper | ✅ | empty-thinking-text |
| 7 | Output suppression | ✅ | runStartupScope-returns-result |
| 8 | Run timeout | ✅ | zero-duration-resolves |
| 9 | MCP timeout override | ✅ | install-restore-round-trips |
| 10 | Executor | ✅ | (covered by mapper CONTROLs) |
| 11 | Barrel + fixture | — | — |
| 12 | Dispatch hook | ✅ | non-external-goes-to-AgentHeadless |
| 13 | Build sweep | — | — |
| 14 | Self-audit | — | — |
| 15 | PR prep | — | — |

**Spec coverage check:** every section of the spec maps to a task:
- §3 Architecture → Tasks 2, 3, 12
- §4 Source→target mapping → Tasks 4, 6, 7, 8, 9, 10
- §5 Types → Task 2, 5
- §6 Registration → Task 3
- §7 MCP/tool-surface → Task 4 (customTools), Task 10 (`mcpServers: {}`)
- §8 Dependencies → Task 1
- §9 Testing → all tasks (TDD gates)
- §10 Dropped → confirmed dropped (no tasks create bridge/abort/diagnostics/runtime-context)
