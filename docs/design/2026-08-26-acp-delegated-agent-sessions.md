# ACP Execution Adapter for Ordinary Agents

> Status: Proposed design
>
> Date: 2026-08-26
>
> Related upstream requests:
> [#10078](https://github.com/QwenLM/qwen-code/issues/10078),
> [#8545](https://github.com/QwenLM/qwen-code/issues/8545),
> [#8105](https://github.com/QwenLM/qwen-code/issues/8105), and
> [#8775](https://github.com/QwenLM/qwen-code/issues/8775)

## Summary

Qwen Code's ordinary `agent` surface already supports foreground and
background execution, task identities, discovery through `list_agents`,
follow-up through `send_message`, cancellation through `task_stop`, and
optional worktree isolation.

Qwen Code also contains an ACP bridge whose production path starts
`qwen --acp` over stdio and manages ACP sessions, prompts, session updates,
permissions, cancellation, and client-side filesystem callbacks.

This design adds an experimental ACP execution adapter behind the existing
ordinary-agent lifecycle. The first implementation uses Qwen through the
existing stdio bridge. The adapter boundary is defined using the standard ACP
subset so another compatible stdio ACP agent can be tested later without
changing the model-visible lifecycle tools.

The first slice gives users an opt-in process-backed ordinary agent whose
transport failure and cancellation can settle independently from the parent's
in-process runtime. More importantly, it proves that the existing ordinary
agent lifecycle can host a protocol-backed session without creating a second
task API. That proof is the prerequisite for later non-Qwen ACP targets.

The proposal does not create a second delegation API. It does not claim that
ACP provides filesystem isolation, write exclusion, arbitrary model routing,
mid-prompt steering, or command-level verification evidence.

## Problem

Ordinary agents currently execute through Qwen's in-process subagent runtime.
That runtime is efficient and tightly integrated, but it is also the only
execution backend available to the model-visible `agent` lifecycle.

An ACP adapter would provide a process and protocol boundary for longer
delegated tasks while preserving the existing user and model contract:

```text
agent
  -> list_agents
  -> send_message
  -> task_stop
```

The missing seam is backend selection and translation between Qwen's ordinary
agent task record and one ACP session. Foreground/background semantics,
worktree ownership, completion notifications, and follow-up behavior should
remain Qwen semantics rather than being reinvented in ACP-specific tools.

## Goals

- Add an experimental stdio ACP execution backend for ordinary agents.
- Preserve the existing `agent`, `list_agents`, `send_message`, and
  `task_stop` surface.
- Use Qwen through `qwen --acp` as the first reference target.
- Define the minimum standard ACP subset required by the adapter.
- Keep Qwen-specific ACP extensions optional and explicitly identified.
- Preserve task identity, foreground/background delivery, worktree behavior,
  permission attribution, cancellation, and terminal reporting.
- Allow the adapter and #10078 to converge on a shared backend-neutral session
  boundary without requiring either request to absorb the other.

## Non-goals for the first implementation

- New model-visible lifecycle tools.
- Generic ACP-over-HTTP transport.
- Arbitrary remote agents or SSH workers.
- A new Agent View or fleet UI.
- Agent Team membership or peer messaging over ACP.
- Mid-prompt steering unless the target advertises a compatible extension.
- Generic model selection or effective-model reporting.
- Read-only or exclusive-write guarantees for an unsandboxed child process.
- Writer leases, changed-file reconciliation, or mandatory command evidence.
- Cross-process or application-restart recovery.
- Replacing the existing in-process backend.

## Existing model-visible lifecycle

The ACP adapter must integrate with the current contract:

- `agent` starts ordinary work. Top-level ordinary agents can run in the
  background, and `run_in_background: false` returns a foreground result.
- `list_agents` returns addressable background tasks and their status.
- `send_message` continues a running, paused, or completed compatible agent.
- `task_stop` cancels a background task.
- `isolation: "worktree"` provisions an agent worktree under the current
  ordinary-agent rules.
- `working_dir` can pin an eligible foreground agent to a caller-owned
  registered worktree.

The adapter must not change those semantics merely because execution occurs
through ACP.

## Proposed selection

The exact configuration syntax is open to maintainer direction. A conceptual
agent definition may select an ACP backend:

```yaml
name: acp-qwen
description: Run an ordinary agent through the ACP session adapter
execution:
  backend: acp
  target: qwen
```

Alternatively, the `agent` tool may expose an experimental backend selector.
The first slice selects a symbolic built-in Qwen target backed by the existing
ACP channel factory. It does not resolve an arbitrary executable from `PATH`,
and command or trust policy cannot be supplied by model output.

Only stdio is in the first scope. The current production bridge already has a
stdio child-channel path. HTTP transport remains future work until a concrete
ACP transport and authentication contract is selected.

## Minimum ACP and host behavior

The first adapter depends only on baseline ACP behavior:

- initialize the ACP connection;
- create a session with a working directory;
- send one prompt at a time per session;
- receive session updates;
- receive terminal prompt completion or failure;
- let the host service permission requests if the target issues them; and
- cancel the active prompt.

The host separately owns child launch, transport closure, process teardown,
ordinary task retention, and mapping ACP prompt stop reasons plus RPC,
cancellation, and transport failures into Qwen task states.

ACP filesystem methods are client capabilities. They are not evidence that the
target agent itself is read-only, write-mediated, or sandboxed.

The following behavior is optional and must not be presented as generic ACP:

- Qwen-specific session extensions;
- explicit model selection and effective-model reporting;
- mid-prompt message injection;
- session resume after process or transport loss;
- target-specific context, usage, task, or recap extensions; and
- supervisor-observed shell commands, exit codes, or complete changed-file
  accounting.

An adapter exposes optional behavior only when both the target and the host
support it. Unsupported optional behavior remains unavailable or unknown; it
is never fabricated from requested configuration.

## Session and task ownership

Qwen's background task remains the model-visible identity. The ACP session ID
is backend metadata attached to that task:

```ts
interface AcpAgentTaskMetadata {
  backend: 'acp';
  sessionId: string;
  childProcessId?: number;
  targetName: string;
  capabilities: string[];
}
```

The task registry continues to own:

- task status shown by `list_agents`;
- completion notifications;
- admission of `send_message`;
- cancellation requested through `task_stop`;
- worktree cleanup or preservation; and
- final terminal settlement.

The ACP adapter owns:

- child launch and transport;
- ACP session creation;
- prompt FIFO for that session;
- translation of session updates;
- permission request correlation;
- prompt cancellation forwarding; and
- child shutdown.

This division avoids adding parallel lifecycle tools.

## Foreground flow

```text
agent(... run_in_background: false, ACP backend)
  -> validate configured target and workspace
  -> start ACP child over stdio
  -> create ACP session for cwd
  -> send task prompt
  -> forward updates and permissions
  -> receive prompt terminal result
  -> return ordinary inline Agent result
  -> close or retain session according to existing ordinary-agent policy
```

The foreground caller waits for the delegated prompt, not because the child is
in process, but because the existing `agent` invocation is foreground.

## Background and follow-up flow

```text
agent(... ACP backend)
  -> register ordinary background task
  -> start ACP session
  -> return normal task identity

list_agents
  -> reads the ordinary task record

send_message(task_id, ...)
  -> if no prompt is active, submit a follow-up ACP prompt
  -> if a prompt is active, queue the message in the ordinary task record
  -> after the active prompt settles, submit the queued text as the next prompt

task_stop(task_id)
  -> cancel active ACP prompt
  -> settle ordinary task state
  -> close child according to task policy
```

Baseline ACP cancellation is supported. Mid-prompt steering is not assumed.
Host-side queueing preserves the current ordinary-agent contract without
requiring a target extension.

“Background” means surviving the initiating model tool call inside the current
Qwen session. Application restart and cross-process recovery remain outside
the first scope.

### Completed-task continuation and retention

The host retains the ACP child and session for the same continuation window
used by the ordinary task registry. During that window, `send_message` starts
the next ACP prompt in the retained session, including after the previous
prompt completed.

The first slice does not use `session/load` and does not reconstruct a lost
session. If the retained child exits, the transport is lost, or the ordinary
task is evicted, continuation returns an explicit unavailable outcome. Normal
session teardown closes the retained child. This policy preserves continuation
while the task is retained without promising application-restart recovery.

## Context transfer

The target receives:

- the ordinary agent task prompt;
- the selected working directory;
- existing agent-definition instructions that can be represented as prompt
  text; and
- explicitly selected files or textual context when supported by the host.

The adapter does not copy Qwen's provider-specific reasoning metadata or raw
internal history into a heterogeneous target.

Qwen through `qwen --acp` may support richer behavior through Qwen-specific
extensions. Those extensions must be labeled as such and cannot become
requirements for another ACP agent.

## Model behavior

Generic ACP does not provide a portable effective-model contract. Therefore:

- the first generic adapter does not require model selection;
- a configured target may select its model through its own launch
  configuration;
- Qwen-specific model selection may be exposed as an optional extension; and
- the UI must not report a requested model as effective unless the target
  confirms it.

This keeps the adapter compatible with the model-routing invariant behind
#10071 without claiming ACP solves that issue automatically.

## Permissions

If a target issues an ACP permission request, the host correlates it with the
ordinary task and ACP session. The parent UI must identify which delegated task
requested the operation.

The adapter does not widen approval policy. A target that requires an
interaction unavailable in the current surface must fail clearly rather than
auto-approve or hang.

## Environment and trust

The existing `qwen --acp` spawn path passes most of the host environment and
removes a targeted denylist. That is consistent with launching another trusted
Qwen process that already has unrestricted shell access.

An arbitrary external-command adapter introduces a different trust boundary.
Before external targets are enabled, configuration must define which command,
arguments, environment variables, credentials, working directories, and
sandbox policy are allowed. Model output must not be able to choose an
arbitrary executable or copy the full parent environment.

The first reference implementation can therefore be restricted to the trusted
built-in Qwen target. A second external implementation should remain
experimental until its trust configuration is reviewed.

## Filesystem and writing

ACP is not a sandbox. Disabling ACP client `writeTextFile` does not make an
unsandboxed child read-only because the child can use its own shell or
filesystem APIs.

The first adapter inherits existing ordinary-agent workspace rules:

- shared working-directory execution may conflict with other writers;
- `isolation: "worktree"` provides a separate Git worktree, not a security
  sandbox; and
- caller-owned worktrees retain their existing foreground lifetime rules.

### Future coordinated writer mode

A later phase may add a sole-writer policy for trusted, fully mediated
execution. That policy is enforceable only if parent tools, teammates, nested
agents, child shell execution, custom tools, and external processes are all
technically prevented from competing writes.

A cooperative lease that only participating Qwen components observe must be
described as coordinated writer ownership, not exclusive filesystem
ownership. Generation fencing, stale cleanup, cache invalidation, and
reconciliation belong to that later design, not the initial ACP adapter
request.

## Result and evidence

The ordinary Agent result remains the compatibility surface. ACP prompt stop
reasons plus RPC, cancellation, and transport failures are mapped into the
existing Qwen terminal task states.

Optional evidence may include:

- target-reported summary;
- target-reported changed files;
- host-observed filesystem changes when worktree support already provides
  them; and
- host-observed commands only when the execution adapter actually mediates
  those commands.

Missing evidence remains unknown. Generic ACP does not guarantee complete
command, exit-code, or changed-file telemetry.

## Relationship to existing issues

### #10078

#10078 proposes a backend-neutral session boundary for Agent Team execution
and Agent View. This design needs a compatible backend boundary for ordinary
agents. The lifecycle API and UI projection should converge where possible,
but the product scopes remain separate:

- #10078 governs teammates owned by `TeamManager`.
- This design governs ordinary tasks owned by the existing agent task
  registry.

Before implementation, maintainers should select the owning seam. The adapter
should extend the session/backend abstraction chosen for #10078 and #8775, or a
smaller shared lifecycle layer, rather than introduce a third parallel session
contract.

### #8545

#8545 concerns making an in-process Qwen subagent visible to an external ACP
client when Qwen itself is serving as the ACP agent. This design reverses the
direction: Qwen is the ACP client and uses another ACP agent as the execution
backend for an ordinary delegated task.

### #8105

#8105 tracks background lifecycle and recovery for Dynamic Workflows. This
design does not add another background control plane; it reuses the ordinary
agent task registry.

### #8775

#8775 proposes a `SessionRuntime` direction spanning ACP and `AgentCore`. The
ordinary-agent adapter should reuse or extend that maintainer-selected runtime
seam if it is suitable; it should not create a competing abstraction.

## Testing

### Adapter contract

- launch the configured stdio target;
- create one session at the requested cwd;
- deliver a foreground prompt and translate its result;
- register and complete a background task;
- project session updates to the correct ordinary task;
- route an issued permission request to the correct task;
- cancel through `task_stop`;
- queue active-prompt follow-up and deliver it as the next prompt;
- continue a completed retained task in the same ACP session;
- reject continuation explicitly after child loss or task eviction;
- terminate on transport loss without reporting success; and
- close the child during task or session teardown.

### Compatibility

- existing in-process behavior remains the default;
- foreground and background result shapes remain compatible;
- `list_agents` shows ACP and in-process tasks through the same vocabulary;
- completion notifications settle once;
- worktree cleanup and preservation follow existing rules; and
- one ACP task cannot cross-attribute another task's events or permissions.

### Interoperability

The first matrix contains:

1. Qwen through the production `qwen --acp` stdio path;
2. a minimal fake ACP agent using only the required standard subset;
3. a capability-limited fake that rejects optional behavior; and
4. a transport that disconnects at controlled lifecycle boundaries.

A real non-Qwen ACP target should be tested before the feature is described as
stable generic interoperability.

## Delivery

### First slice

- Add an experimental ACP backend selection for an ordinary agent definition.
- Support only the trusted built-in Qwen stdio target.
- Run foreground and background prompts through the existing ordinary-agent
  lifecycle.
- Preserve queued follow-up and retained-task continuation semantics.
- Support baseline updates, permission handling, cancellation, and teardown.
- Reuse the maintainer-selected session/backend seam shared with #10078 or
  #8775 rather than adding a parallel session abstraction.
- Add Qwen and generic fake-agent contract tests.

### Second slice

- Define reviewed configuration and environment policy for an external stdio
  ACP target.
- Validate one real non-Qwen implementation.
- Expose only standard capabilities plus explicitly labeled extensions.

### Later work

- Shared UI/session projection with #10078.
- Application-restart recovery when both host and target support it.
- Sandboxed read-only policy.
- Fully mediated coordinated writer ownership.
- Optional model, steering, usage, and evidence extensions.
- Additional authenticated transports.

## Public acceptance criteria

- An ordinary agent definition can select an experimental ACP backend.
- The first built-in target runs Qwen through the existing stdio ACP bridge.
- Foreground and background behavior remains accessible through the existing
  `agent` lifecycle.
- `list_agents`, `send_message`, and `task_stop` continue to address the task,
  with active-prompt messages queued for the next prompt and unavailable
  continuation reported explicitly after child loss or task eviction.
- Session updates, permissions, cancellation, failures, and terminal state are
  attributed to the correct task.
- ACP stop reasons and RPC, cancellation, and transport failures map into the
  existing Qwen task-state vocabulary.
- Transport loss cannot be reported as successful completion.
- The in-process backend remains the default.
- The minimum adapter contract is testable against a generic fake ACP agent.
- ACP is not described as a sandbox or as an Agent Team peer protocol.
- The implementation reuses the maintainer-selected session/backend seam
  instead of adding a third parallel session contract.
