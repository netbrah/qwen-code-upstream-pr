# Cursor-coder Subagent Port — Design

Date: 2026-08-16
Branch: `worktree-cursor-coder-port`
Status: Design (pre-implementation)

## 1. Goal

Port the `cursor-coder` subagent — a Cursor-SDK-backed coding subagent that
drives an external `@cursor/sdk` agent loop and bridges the parent's tool
surface into it — from the apex-ontap/spectre fork lineage into upstream
qwen-code's `dogfood-2026-08-12` shape. The port must be **native to
upstream's subagent chassis** (not a transplant of the fork's `cli-subagent/`
infrastructure), **default-off** (gated on `CURSOR_API_KEY`), and
**upstream PR-ship-worthy** (clean seams, no fork-specific coupling, no
NetApp corp-network workarounds).

The core value proposition — a Cursor-backed coding subagent whose loop can
call qwen's first-party tools natively — is preserved via the `@cursor/sdk`
native `customTools` API (the newer apex-ontap `sortie/cursor-custom-tools`
shape), NOT the older loopback HTTP MCP bridge.

## 2. Decisions (locked)

| Dimension | Decision |
|---|---|
| Adaptation strategy | **C — builtin subagent + dispatch hook.** `cursor-coder` registered in `BuiltinAgentRegistry`; one hook in `agent.ts` routes `externalInvocation.kind:'cursor'` configs to `CursorAgentInvocation` instead of `AgentHeadless`. |
| Tool bridging | **`@cursor/sdk` native `customTools` API.** In-process `execute` callbacks passed on `Agent.create({ local: { customTools } })`. No loopback HTTP server, no port, no token, no `apex__` prefix. The older MCP bridge is dropped entirely. |
| Source of truth | **apex-ontap `sortie/cursor-custom-tools` branch** (newer shape). dev2/spectre is the older bridge shape — used only as cross-reference. Both are "prod but legacy". |
| Registration | `cursor-coder` entry in `BuiltinAgentRegistry`, gated on `CURSOR_API_KEY` (entry elided when env var unset → users without a key see no change). |
| Type surface | Add `externalInvocation?: ExternalAgentInvocation` discriminant to `SubagentConfig`. Discriminated union: `{ kind: 'cursor'; cursorModel; trust; isolatedCwd; cursorRun? }`. Generalizes to future external agents (add a `kind` + invocation class). |
| `systemPrompt` | Required by `SubagentConfig` type; set to a placeholder for cursor-coder (SDK doesn't use it). The `agent` tool's model-visible description uses `config.description`, not `systemPrompt`. |
| Sandbox | `cursorRun.sandbox.enabled: false` (required so customTools/MCP can execute — SDK installs a deny-all gate when sandbox is on and there's no operator to approve in headless). |
| Trust gate | `trust: true` boundary gate at delegation time. Cursor owns its tool loop; qwen policy cannot veto individual in-loop tool calls. `getConfirmationDetails` requires boundary confirmation. SDK approval (`request`/`interaction_query`) events are auto-denied (no HITL across the seam). |
| Model | `cursorModel: 'default'` (bypasses Cursor entitlement budget-exhaustion failure mode where every premium id silently fails). |
| Env var rebrand | `APEX_CURSOR_*` → `QWEN_CURSOR_*` (debug/trace env vars). `CURSOR_API_KEY` stays as-is (upstream-neutral, set by the operator). |
| Corp-network code | **Dropped.** `ensureCursorH1Config`, `APEX_CURSOR_HTTPS_PROXY` env scoping, curl shim, Palo Alto DPI bypass. Upstream runs on direct-egress networks; `useHttp1ForAgent: true` is kept on `local` (no-op on direct egress, harmless). |
| Runtime-context pseudo-tool | **Deferred to a second slice.** Not core to the value prop; ports cleanly later once the base invocation lands. |
| `maxTurns` semantics | Logical turns (one increment per tool round-trip), deduped by call_id. `maxTurns: 300`, `maxTimeMinutes: 150`. |
| `@cursor/sdk` version | `^1.0.18` (matches apex-ontap). Lazy-imported so the heavy sqlite3/protobuf dep never loads on the default launch path. |

Explicitly rejected:
- **Approach A** (external-invocation `kind` discriminant on SubagentConfig +
  sibling registry) — cleaner generalization but touches more of upstream's
  subagent core than this task needs.
- **Approach B** (standalone `cursor_coder` first-party tool) — loses `/agents`
  UX, subagent telemetry, delegation model.
- **Loopback HTTP MCP bridge** — replaced by the SDK's native `customTools`
  API; 600+ lines of bridge/abort/diagnostics code rendered obsolete.
- **Porting the fork's `cli-subagent/` infra** — not needed; `customTools` is
  in-process; upstream's `BuiltinAgentRegistry` + `agent` tool already provide
  the dispatch chassis.
- **CLI-path variants** (`cursor-coder-cli-spectre.ts`, `cursor-coder-cli-ontap.ts`,
  `cursor-cli-invocation.ts`) — upstream uses the SDK path only.

## 3. Architecture

```
                    ┌──────────────────────────────────────────────┐
                    │ BuiltinAgentRegistry (subagents/builtin-  │
                    │       agents.ts)                           │
                    │                                           │
                    │  + cursor-coder  (gated on CURSOR_API_KEY)│
                    │    externalInvocation: { kind:'cursor',   │
                    │      cursorModel:'default', trust:true,    │
                    │      isolatedCwd:false,                    │
                    │      cursorRun:{sandbox:{enabled:false}} }│
                    └─────────────────┬─────────────────────────┘
                                      │
                              ┌───────▼───────┐
                              │  agent tool   │  (tools/agent/agent.ts)
                              │  dispatch     │
                              └───────┬───────┘
                                      │
                    ┌─────────────────▼─────────────────────────┐
                    │  config.externalInvocation?.kind === 'cursor'  │
                    │     → CursorAgentInvocation.execute()     │
                    │  else → AgentHeadless (unchanged)         │
                    └─────────────────┬─────────────────────────┘
                                      │
              ┌───────────────────────▼────────────────────────┐
              │  packages/core/src/agents/cursor/              │
              │                                                │
              │  cursor-invocation.ts    CursorAgentInvocation │
              │  cursor-custom-tools.ts  buildCustomTools()    │
              │  cursor-sdk-output-      CursorSdkOutput-      │
              │    suppression.ts         Suppressor           │
              │  cursor-mcp-timeout-     install/restore       │
              │    override.ts            timeout override     │
              │  types.ts                structural SDK mirrors│
              │  index.ts                public exports        │
              └────────────────────────────────────────────────┘
```

### Dispatch hook (the ONLY change to upstream's subagent core)

In `tools/agent/agent.ts`, after resolving `SubagentConfig` for a
`subagent_type`, check `config.externalInvocation?.kind`. If `'cursor'`,
construct `CursorAgentInvocation(definition, context, params)` and run it
via `BaseToolInvocation.execute({ abortSignal, updateOutput })` — the same
`execute` contract the fork's invocation uses — instead of spawning
`AgentHeadless`. All other dispatch paths (forks, teammates, in-process
subagents) are unchanged.

The hook is ~10 lines: one `if` branch. It generalizes — future external
agents (claude-cli, gemini-cli) add their own `kind` value + invocation
class under the same hook.

## 4. Source → target file mapping

| apex-ontap source (sortie/cursor-custom-tools) | upstream target | treatment |
|---|---|---|
| `agents/cli-subagent/cursor-custom-tools.ts` (~150 lines) | `agents/cursor/cursor-custom-tools.ts` | **Port.** Adapt `ApexToolRegistryLike` → upstream `ToolRegistry` interface (`getAllTools()`, tool `name`/`description`/`parameterSchema`/`buildAndExecute`). Rebrand env-var debug prefix. |
| `agents/cli-subagent/cursor-invocation.ts` (2149 lines) | `agents/cursor/cursor-invocation.ts` | **Port + strip.** Keep: pure mapper (`mapCursorEvent`, `extractAssistantText`, `mapRunResultToOutput`, `applyActivity`), `resolveCursorApiKey`, `toCursorModelParams`, `resolveSettingSources`, `CursorAgentInvocation.execute` (SDK create/send/stream/wait/cancel), logical-turn counting, `PERMISSION_GATE` handling, `CursorSdkError` distinction. **Strip:** `CursorToolBridgeRegistry` path (bridge is legacy — drop the `toolBridge.enabled` branch entirely), `toCursorMcpServers` (dead on customTools path), `ensureCursorH1Config`, `APEX_CURSOR_HTTPS_PROXY` env scoping, curl shim / `globalThis.fetch` patch, `spawn` import (curl shim only). **Adapt:** `RemoteAgentInputs`/`AgentInputs`/`OutputObject`/`SubagentActivityEvent`/`SubagentProgress` types → upstream equivalents (see §5). `toQwenAgentResultDisplay` → upstream's `ToolResultDisplay` path. `AgentLoopContext` → upstream's `Config` + tool-registry accessors. |
| `agents/cli-subagent/cursor-sdk-output-suppression.ts` | `agents/cursor/cursor-sdk-output-suppression.ts` | **Port as-is.** Self-contained stdout/stderr/console suppression during SDK startup. |
| `agents/cli-subagent/cursor-mcp-timeout-override.ts` | `agents/cursor/cursor-mcp-timeout-override.ts` | **Port, trim.** Bounds SDK MCP connect/tool timers. With `customTools` (no bridge cold-start) the override is less critical but still bounds any external `mcpServers` the operator configures. Keep; verify relevance during implementation. |
| `agents/cli-subagent/cursor-coder-runtime-context.ts` | — | **Defer** (second slice). Refinement: a pseudo-tool whose description carries session bootstrap context to the LLM. Not core to the value prop. |
| `agents/cli-subagent/cursor-tool-bridge.ts` (~600 lines) | — | **Drop.** Replaced by `customTools`. |
| `agents/cli-subagent/cursor-tool-bridge-abort.ts` | — | **Drop.** Bridge-specific. |
| `agents/cli-subagent/cursor-tool-bridge-diagnostics.ts` | — | **Drop.** Bridge-specific. |
| `agents/cli-subagent/cursor-tool-bridge-diagnostics-wiring.test.ts` | — | **Drop.** Bridge-specific. |
| `agents/cli-subagent/spectre-mcp-tool-collection.ts` | — | **Drop.** Spectre-specific (`inheritSpectreMcpServers`, `buildCursorToolBridgeSnapshot`). |
| `agents/cursor-coder-cli-ontap.ts` (definition) | `BuiltinAgentRegistry` entry in `subagents/builtin-agents.ts` | **Re-encapsulate.** `CursorAgentDefinition` → `SubagentConfig + externalInvocation`. `inheritAllApexMcpServers` **dropped** (customTools covers the tool surface in-process — see §7). |
| `agents/types.ts` (`CursorAgentDefinition`, `CursorModelParams`, `RemoteAgentInputs`, `OutputObject`, `SubagentActivityEvent`, `SubagentProgress`, `AgentTerminateMode`) | `agents/cursor/types.ts` + upstream's existing runtime types | **Adapt.** Cursor-specific types live in `agents/cursor/types.ts`. Activity/progress types map onto upstream's `agents/runtime/agent-events.ts` / `agent-types.ts`. |
| `agents/cli-timeout.ts` (`withRunTimeout`, `CliRunTimeoutError`) | `agents/cursor/cursor-invocation.ts` (inline) or a shared `agents/runtime/cli-timeout.ts` | **Port** the timeout helper. Check if upstream has an equivalent first. |
| `agents/__fixtures__/cursor-cli-stream-sample.jsonl` | `agents/cursor/__fixtures__/cursor-sdk-stream-sample.jsonl` | **Port** for mapper fixture tests. |
| `reference/pi-cursor-sdk/**` | — | **Drop.** Vendored reference; not imported by production code. |
| `reference/cursor-cookbook/SOURCE.md` | — | **Drop.** Reference doc. |
| `packages/core/src/skills/bundled/ipsec/references/cursor-coder-operating-rules.md` | — | **Drop.** ONTAP-specific skill doc. (A qwen-specific operating-rules doc could be a follow-up.) |

## 5. Types — the `externalInvocation` discriminant

```ts
// subagents/types.ts (ADD to existing SubagentConfig)

/**
 * Optional external-agent invocation config. When present, the agent tool
 * dispatches to the named external invocation class instead of AgentHeadless.
 * The discriminant `kind` selects the invocation path.
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
  modelParams?: { reasoning?: string; effort?: string; thinking?: boolean };
}
```

`SubagentConfig` gains `externalInvocation?: ExternalAgentInvocation`. The
`agent` tool checks it post-resolution. `systemPrompt` stays required on the
type (cursor-coder sets a placeholder; the SDK ignores it).

## 6. Registration — `BuiltinAgentRegistry` entry

In `subagents/builtin-agents.ts`, add to the `BUILTIN_AGENTS` array (elided
when `CURSOR_API_KEY` is unset — the registry's static array can't be env-
conditional at construction time, so the entry is always present but the
`agent` tool's dispatch checks `CURSOR_API_KEY` at resolve time and skips
listing if unset; alternatively a static getter filters — see implementation
plan for the exact mechanism):

```ts
{
  name: 'cursor-coder',
  description: <ported from apex-ontap, rebranded apex→qwen>,
  systemPrompt: '<placeholder — cursor SDK ignores; see externalInvocation>',
  tools: [],  // tools are NOT used — cursor runs its own loop + customTools
  runConfig: { maxTimeMinutes: 150, maxTurns: 300 },
  externalInvocation: {
    kind: 'cursor',
    cursorModel: 'default',
    trust: true,
    isolatedCwd: false,
    cursorRun: { sandbox: { enabled: false }, settingSources: ['project'] },
  },
  // NOTE: no `mcpServers` on the registration — when customTools is active
  // (the default), the SDK gets `mcpServers: {}` to suppress disk discovery,
  // and the customTools record (built from qwen's tool registry, which already
  // includes MCP-backed tools qwen manages in-process) covers the full tool
  // surface. See §7.
}
```

## 7. MCP server / tool-surface handling

The fork's `inheritAllApexMcpServers(config)` forwards the parent's MCP
servers to the Cursor SDK's `mcpServers` field — but that field is ONLY used
on the legacy bridge path (`toolBridge.enabled === true`), which we are
dropping.

On the `customTools` path (our default), the tool surface is covered
in-process:

- `buildCustomTools({ registry: config.getToolRegistry() })` iterates
  upstream's `ToolRegistry.getAllTools()`, which **already includes MCP-backed
  tools** that qwen manages via its own MCP client connections. Each tool's
  `execute` callback calls `tool.buildAndExecute(args, signal)` directly —
  same execution path as a normal in-process tool call, no SDK-spawned MCP
  server processes.
- The SDK is passed `mcpServers: {}` (empty, not `undefined`) to suppress its
  disk-based discovery of `~/.cursor/mcp.json`. Without this, the SDK
  auto-loads the user's Cursor MCP servers and the model sees duplicate tools.
- `toCursorMcpServers()` + the definition's `mcpServers` field are dead code
  on the customTools path — dropped from the port (no `mcpServers` on the
  registration, no `inheritAllApexMcpServers`).

Net: qwen's full active tool surface (first-party + MCP-backed) is exposed
into cursor's loop via the native `customTools` API, in-process, with no
HTTP server and no duplicate MCP processes.

## 8. Dependencies

- **`@cursor/sdk@^1.0.18`** — add to `packages/core/package.json`
  `dependencies`. Platform-specific optional deps:
  `@cursor/sdk-darwin-arm64`, `@cursor/sdk-darwin-x64`,
  `@cursor/sdk-linux-arm64`, `@cursor/sdk-linux-x64`,
  `@cursor/sdk-win32-x64`. Lazy-imported (`await import('@cursor/sdk')`) so
  the heavy sqlite3/protobuf dep never loads on the default launch path.
- **`@modelcontextprotocol/sdk`** — already a dep upstream. Used by
  `cursor-mcp-timeout-override.ts` type imports only (the bridge that used
  it heavily is dropped).
- No other new deps.

## 9. Testing strategy — TDD review gates

Per the user's RED-before-GREEN TDD requirement, each behavioral unit gets a
test written and captured-failing BEFORE the implementation. Tests are
dispatched to subagent teams (per the user's subagent-driven-development
preference). Each subagent reports per-test RED evidence (the real assertion
message) alongside the GREEN run, plus at least one deliberately-passing
CONTROL test that stays green throughout (controls stop degenerate
implementations).

### Unit tests (pure, portable — port from apex-ontap)

| Test file | Covers | Source fixture |
|---|---|---|
| `agents/cursor/cursor-invocation.test.ts` | `mapCursorEvent` (all SDK message types → activity events), `extractAssistantText`, `mapRunResultToOutput` (finished/cancelled/error), `applyActivity` (THOUGHT_CHUNK/TOOL_CALL_START/TOOL_CALL_END/ERROR/PERMISSION_GATE merge + dedup + max-activity cap), `resolveCursorApiKey` (explicit/env/placeholder), `toCursorMcpServers` (stdio/http/sse/empty), `toCursorModelParams` (reasoning/effort/thinking interactions), `resolveSettingSources` | `__fixtures__/cursor-sdk-stream-sample.jsonl` |
| `agents/cursor/cursor-custom-tools.test.ts` | `buildCustomTools` (registry → customTools record, overlapping-native-name exclusion, `execute` callback success/error/abort, content conversion text/image/inline-data) | mock `ToolRegistry` |
| `agents/cursor/cursor-sdk-output-suppression.test.ts` | install/uninstall, stdout/stderr/console suppression scope, runStartupScope | — |
| `agents/cursor/cursor-mcp-timeout-override.test.ts` | install/restore, default-timeout detection, stack-classification | — |
| `subagents/builtin-agents.test.ts` (EDIT) | `cursor-coder` entry present when `CURSOR_API_KEY` set, elided when unset; `externalInvocation` shape | — |
| `tools/agent/agent.test.ts` (EDIT) | dispatch hook: config with `externalInvocation.kind:'cursor'` routes to `CursorAgentInvocation` (mocked), not `AgentHeadless`; config without `externalInvocation` unchanged | — |

### Integration test (stream replay)

A fixture-replay test that feeds a recorded SDK message stream through
`CursorAgentInvocation.execute()` (with the SDK `import` mocked to yield the
fixture) and asserts the final `ToolResult` + emitted `SubagentProgress`
events. This is the apex-ontap `cursor-family.fixture-replay.test.ts` pattern,
ported.

### TDD review gates (sequence)

1. **Gate 1 — Types + registration RED.** Write tests for `externalInvocation`
   on `SubagentConfig` + `cursor-coder` in `BuiltinAgentRegistry`. Capture
   RED (type doesn't exist; entry not present). Implement. Capture GREEN.
2. **Gate 2 — Pure mapper RED.** Write `cursor-invocation.test.ts` mapper
   tests against the fixture. Capture RED. Port the pure functions. Capture
   GREEN. Include a CONTROL test (e.g., a passing-through case that should
   always succeed) that stays green.
3. **Gate 3 — `buildCustomTools` RED.** Write customTools tests. Capture RED.
   Port `cursor-custom-tools.ts`. Capture GREEN.
4. **Gate 4 — Dispatch hook RED.** Write `agent.test.ts` dispatch-hook test.
   Capture RED. Add the hook to `agent.ts`. Capture GREEN.
5. **Gate 5 — `CursorAgentInvocation.execute` RED.** Write fixture-replay
   integration test. Capture RED. Port the executor (stripped of NetApp
   code). Capture GREEN.
6. **Gate 6 — Output suppression + MCP timeout RED.** Write tests. Capture
   RED. Port. Capture GREEN.
7. **Gate 7 — Full build + typecheck + lint.** `npm run build && npm run
   typecheck && npm run lint` clean.
8. **Gate 8 — Self-audit.** Read the full diff; verify each change; verify
   each green test isn't asserting the wrong thing. Two consecutive clean
   passes.

### Stash-and-rerun check

Before each gate's GREEN claim: stash the implementation, re-run the tests,
confirm they fail (pre-existing failures distinguished from regressions).
Restore. This is the user's required check that RED is real and GREEN is
caused by the implementation.

## 10. Explicitly dropped (legacy / out of scope)

- Loopback HTTP MCP bridge: `cursor-tool-bridge.ts`, `-abort.ts`,
  `-diagnostics.ts`, `-diagnostics-wiring.test.ts`
- `spectre-mcp-tool-collection.ts`, `inheritSpectreMcpServers` /
  `inheritAllApexMcpServers`
- NetApp corp-network workarounds: `ensureCursorH1Config`,
  `~/.cursor/cli-config.json` H1 patch, `APEX_CURSOR_HTTPS_PROXY` env
  scoping, curl shim / `globalThis.fetch` patch, Palo Alto DPI bypass
- `cursor-coder-runtime-context.ts` (second slice)
- `cli-subagent/` infra (process-supervisor, adapters, registry, replay,
  exit-classifier, telemetry-lifecycle, etc.) — not needed; `customTools` is
  in-process
- CLI-path variants: `cursor-coder-cli-spectre.ts`,
  `cursor-coder-cli-ontap.ts`, `cursor-cli-invocation.ts`
- `reference/pi-cursor-sdk/**`, `reference/cursor-cookbook/**`
- `cursor-coder-operating-rules.md` skill doc (ONTAP-specific)

## 11. Risks & open questions

| Risk | Mitigation |
|---|---|
| `@cursor/sdk` platform-specific deps bloat `node_modules` | Optional deps + lazy import; platform packages only install on the matching OS. Document in package.json. |
| `CursorAgentInvocation` extends `BaseToolInvocation` — confirm upstream's `BaseToolInvocation` constructor signature matches the fork's (fork passes `messageBus`; upstream may differ) | Verify in implementation Gate 1; adapt the constructor to upstream's `BaseToolInvocation` shape. |
| `SubagentConfig.systemPrompt` required but unused for cursor-coder | Placeholder string; document why. Alternatively, make `systemPrompt` optional when `externalInvocation` is present (type change — decide during implementation). |
| `BuiltinAgentRegistry` static array can't be env-conditional at construction | The `agent` tool's `refreshSubagents` / `listSubagents` filters at resolve time. Or: `BuiltinAgentRegistry.getBuiltinAgents()` filters by env. Decide during implementation. |
| Activity/progress type mapping (fork `SubagentActivityEvent` → upstream `AgentEventEmitter` events) | Map in `cursor-invocation.ts`; upstream's `agents/runtime/agent-events.ts` has `AgentToolCallEvent`/`AgentToolResultEvent`/`AgentFinishEvent` etc. Verify shape compatibility in Gate 5. |
| `CursorSdkError` `instanceof` check requires the SDK to be loaded | Lazy import already loads it before the check. Structural mirror type kept for tests that don't load the SDK. |
| `@cursor/sdk` may have moved to a newer version with breaking API changes | Pin `^1.0.18`; verify the `Agent.create`/`send`/`stream`/`wait`/`cancel`/`supports`/`CursorSdkError` shapes still match. If a newer version is required, update the structural mirror types. |

## 12. Out of scope / future slices

- **Runtime-context pseudo-tool** (`cursor-coder-runtime-context.ts`) —
  delivers session bootstrap context to the LLM via a pseudo-tool whose
  description carries cwd/workspace-kind/MCP-server-names. Ports cleanly
  once the base invocation lands.
- **CLI-path cursor-coder** (`cursor-cli-invocation.ts`) — for environments
  where the SDK binary is invoked as a subprocess rather than the JS SDK
  library. Upstream uses the SDK path only; CLI path is a future option.
- **Other external-agent families** (claude-cli, gemini-cli, xli) — the
  `externalInvocation` discriminant generalizes; adding a new `kind` +
  invocation class under the same dispatch hook is the pattern.
- **Operating-rules skill doc** — a qwen-specific companion skill doc for
  cursor-coder operating conventions (when to prefer it, trust boundary
  implications).
