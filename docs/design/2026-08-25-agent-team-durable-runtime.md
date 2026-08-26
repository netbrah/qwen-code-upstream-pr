# Durable Agent Team runtime

> Status: Proposed
>
> Date: 2026-08-25
>
> Target: Qwen Code Agent Teams on current `main`
>
> Branch: `design/agent-team-durable-runtime`

> Issue drafts:
> [`docs/design/agent-team-durable-runtime-issues/`](agent-team-durable-runtime-issues/)

## Problem statement

Qwen Code Agent Teams provide useful coordination semantics today: named
teammates, shared tasks, peer and leader messaging, plan approval, bounded
read-only workers, and interactive Agent View tabs. The implementation is
currently fused to `InProcessBackend`, however, so every teammate is an
`AgentCore` and `AgentInteractive` object inside the leader's Node process.

That coupling creates four user-visible constraints:

1. a leader-process failure ends the whole team;
2. teammate sessions cannot survive, reconnect, or be inspected from a later
   CLI process;
3. the UI must hold direct `AgentInteractive` references rather than consuming
   a transport-safe session projection;
4. message success currently means accepted by an in-memory queue, not
   durably delivered or admitted at a model-turn boundary.

These are not arguments for replacing Agent Teams. `TeamManager`, the team
tools, shared tasks, mailbox control messages, `/coordinate`, and Agent View
already form a strong coordination plane. The missing layer is a
backend-neutral session contract and an optional supervised execution backend.

The goal is to evolve the existing feature through small vertical slices from
current `main`, not revive the abandoned Fleet branch wholesale.

## Historical context

Qwen Code already explored this direction:

- [#8718](https://github.com/QwenLM/qwen-code/issues/8718) proposed native
  coordination for independent Qwen sessions.
- [#8840](https://github.com/QwenLM/qwen-code/issues/8840) established an
  in-process Fleet preview.
- [#8841](https://github.com/QwenLM/qwen-code/issues/8841) specified a
  supervised teammate runtime.
- [#8842](https://github.com/QwenLM/qwen-code/issues/8842) specified
  persistence, recovery, and hardening.
- [#8843](https://github.com/QwenLM/qwen-code/issues/8843) reserved terminal
  attach and legacy cleanup.
- [PR #8869](https://github.com/QwenLM/qwen-code/pull/8869) implemented a
  supervised Fleet workspace but was closed after growing to 43 changed files
  and exposing unresolved lifecycle and control-credential boundaries.

The closing guidance on #8841 was specific: if dogfooding the in-process
implementation exposed a concrete subprocess-isolation gap, the supervised
runtime should return as a smaller vertical slice from `main`. This document
follows that guidance.

Prime Agent is useful prior art for the target shape. It separates client
rendering, supervisor lifecycle, worker execution, and session projection
behind an `AgentConnection` boundary. Prime Agent does not use ACP as its
internal teammate protocol; it uses an authenticated local daemon protocol.
This proposal adopts that separation without importing Prime Agent code or
replacing Qwen's coordination semantics.

## Goals

### User goals

- A user can opt into process-backed teammates without changing how
  `/coordinate`, team tools, tasks, or Agent View work.
- A failed teammate does not terminate the leader or unrelated teammates.
- The leader receives explicit queued, admitted, failed, and terminal
  lifecycle signals instead of inferring them from UI objects.
- Teammate transcripts remain inspectable through the existing Agent View.
- A future release can recover or reattach sessions without another UI
  rewrite.

### Engineering goals

- Remove direct `AgentInteractive` ownership from Agent View registration.
- Preserve `TeamManager` as the authority for decomposition, task ownership,
  routing policy, budgets, and shutdown.
- Make execution placement a `Backend` decision.
- Reuse the current Agent View supervisor, protocol, PTY host, attach lease,
  and presentation infrastructure where their contracts fit.
- Land the design as independently testable vertical slices from `main`.

## Non-goals

- ACP as the horizontal peer-message or team-state protocol.
- Remote or SSH workers in the first implementation.
- Heterogeneous providers in the first implementation.
- Raw PTY takeover in the first implementation.
- Hibernation, distributed consensus, or exactly-once model execution.
- Replacing `TeamManager`, team tools, task files, or `/coordinate`.
- Creating a second team roster or a competing Prime-branded feature.
- Claiming that a subprocess, working directory, or Git worktree is a
  security sandbox.
- Allowing multiple teammates to write concurrently to one checkout.

## User stories

- As a team leader, I want one teammate crash to be isolated so that the rest
  of the coordinated task can continue.
- As a team leader, I want message receipts to distinguish queued from
  admitted so that I know whether a teammate actually received an instruction.
- As a user, I want a subprocess teammate to appear in the same Agent View as
  an in-process teammate so that execution placement does not fragment the UI.
- As a user, I want to inspect a terminated teammate's transcript so that a
  crash does not erase evidence.
- As a maintainer, I want in-process and supervised sessions to satisfy one
  contract suite so that backend behavior cannot silently diverge.
- As a future integration author, I want worker transport below the team
  coordination plane so that ACP or another adapter can be added without
  redefining tasks or peer messaging.

## Current architecture

The current route is:

```text
/coordinate
  -> bundled coordinate skill
  -> team_create
  -> Config.teamManager
  -> TeamManager
  -> InProcessBackend
  -> AgentCore + AgentInteractive
  -> useTeamInProcess
  -> AgentViewContext
  -> AgentTabBar / AgentChatView / AgentComposer
```

### Coordination ownership

`packages/core/src/agents/team/TeamManager.ts` owns:

- named membership and identity;
- task assignment and automatic claiming;
- peer, leader, shutdown, and approval routing;
- final report delivery;
- status transitions and stall detection;
- team cleanup.

This remains the coordination authority.

### Runtime ownership

`packages/core/src/agents/backends/InProcessBackend.ts` creates a per-agent
configuration, tool registry, content generator view, `AgentCore`, and
`AgentInteractive`. It runs them in the leader's Node process.

### UI coupling

`packages/cli/src/ui/hooks/useTeamInProcess.ts` narrows the team backend to
`InProcessBackend`, retrieves an `AgentInteractive`, and stores that live
object in `AgentViewContext`.

This is the first coupling to remove. A remote or process-backed backend cannot
provide an `AgentInteractive` object to the leader process.

### State and transport

- `TeamFile` persists team identity and members.
- One JSON file per task persists shared task state.
- Structured control messages use locked mailbox JSON files.
- Ordinary teammate messages use an in-memory queue and direct
  `enqueueMessage()`.
- `TeamEventEmitter` provides in-process notifications.

The storage formats are usable for an incremental migration, but plain-message
admission and UI events need transport-safe contracts.

## Proposed architecture

```text
/coordinate and team tools
            |
            v
       TeamManager
  coordination and policy
            |
            v
        TeamBackend
       /           \
      v             v
InProcessBackend  SupervisorBackend
      |             |
      v             v
InProcessSession  local authenticated supervisor
                    |
                    +-- teammate worker process
                    +-- teammate worker process
                    +-- teammate worker process

Both backends expose TeamAgentSession
            |
            v
     session snapshots/events
            |
            v
       Agent View bridge
            |
            v
 existing tabs, chat, composer, approvals
```

### Ownership boundary

`TeamManager` owns:

- team membership and roles;
- task graph and ownership;
- routing policy and message priority;
- delegation limits;
- plan and permission policy;
- leader synthesis and shutdown intent.

The supervisor owns:

- worker creation and termination;
- authenticated local transport;
- worker and session IDs;
- health and terminal status;
- transcript projection;
- input admission receipts;
- event sequencing and snapshot replacement;
- later recovery and attachment.

The worker owns:

- model turns;
- tool execution;
- transcript state;
- per-agent configuration;
- local input scheduling;
- the effective model and provider runtime.

## Session contract

Introduce a backend-neutral session contract in Core. The exact names may
follow existing runtime conventions; behavior is normative.

```ts
export interface TeamAgentSession {
  readonly agentId: string;

  getSnapshot(): TeamAgentSnapshot;
  subscribe(listener: TeamAgentEventListener): () => void;

  submit(input: TeamAgentInput): Promise<TeamAgentAdmissionReceipt>;
  answerApproval(response: TeamAgentApprovalResponse): Promise<void>;
  interrupt(): Promise<void>;
  stop(): Promise<void>;
  dispose(): Promise<void>;
}
```

The snapshot must be serializable:

```ts
export interface TeamAgentSnapshot {
  agentId: string;
  name: string;
  status: AgentStatus;
  model?: string;
  cwd: string;

  messages: SerializableAgentMessage[];
  streaming: boolean;
  activeTools: ToolActivityProjection[];
  pendingApproval?: ApprovalProjection;

  sessionId?: string;
  workerId?: string;
  generation: number;
  eventCursor: number;
  terminalReason?: string;
}
```

The UI must not require access to `AgentCore`, `AgentInteractive`, a tool
registry, credentials, or provider objects.

### In-process adapter

`InProcessTeamAgentSession` wraps the current `AgentInteractive` and translates
its status, transcript, tool, and approval events into the session contract.
This phase must preserve current behavior and remain the default.

### Supervised adapter

`SupervisedTeamAgentSession` sends protocol operations to the existing local
Agent View supervisor and receives snapshot/event updates. The supervisor
launches a Qwen teammate worker and owns its control credential.

`TeamManager` receives a `TeamAgentSession` from the backend in both cases. It
must not branch on backend type for ordinary coordination.

## Input admission

Current `send_message` success conflates queue acceptance and delivery.
Supervised execution requires explicit states.

```ts
export type TeamAgentInputLane =
  | 'next_turn_boundary'
  | 'when_idle';

export type TeamAgentInputKind =
  | 'peer_message'
  | 'leader_message'
  | 'task_assignment'
  | 'plan_decision'
  | 'shutdown'
  | 'steering';

export interface TeamAgentInput {
  inputId: string;
  sender: string;
  kind: TeamAgentInputKind;
  lane: TeamAgentInputLane;
  priority: number;
  body: unknown;
}

export interface TeamAgentAdmissionReceipt {
  inputId: string;
  state: 'queued' | 'admitted' | 'rejected';
  reason?: string;
}
```

Worker events extend the lifecycle:

```text
queued
  -> admitted
  -> running
  -> completed

queued/admitted
  -> rejected | cancelled | failed
```

Transport acceptance is not model admission. `MESSAGE_SENT` should either be
renamed to reflect queue acceptance or be complemented by admitted and failed
events.

Two lanes are sufficient:

- `next_turn_boundary` for steering, approval, cancellation, and urgent
  control;
- `when_idle` for ordinary peer messages, task assignment, and follow-up.

This contract provides a direct path to resolving
[#8172](https://github.com/QwenLM/qwen-code/issues/8172), where a teammate
message waits behind the leader's entire multi-tool turn.

## Supervisor protocol

The first supervised slice needs a deliberately small operation set:

```text
spawn
submit
snapshot
subscribe
answerApproval
interrupt
stop
```

Every command includes:

- protocol version;
- team ID;
- agent ID;
- session ID;
- worker generation;
- command or input ID.

Every event includes:

- session ID;
- worker generation;
- monotonically increasing event cursor;
- event type;
- serializable payload.

The leader rejects stale-generation events. If an event gap cannot be replayed,
the session requests a full snapshot rather than guessing state.

### Credential boundary

- The leader receives a client capability sufficient to call the supervisor.
- Each worker receives a worker-scoped capability.
- A worker capability cannot create or control sibling workers.
- Supervisor credentials are removed from worker shell environments.
- Child processes launched by tools do not inherit control credentials.
- A teammate cannot invoke `team_create` or nested named teammate spawn.

These are release-blocking invariants, not hardening follow-ups.

## Agent View integration

Replace `useTeamInProcess` with a session-driven bridge, tentatively
`useTeamAgentSessions`.

`RegisteredAgent` should retain a session projection rather than a live
`AgentInteractive`:

```ts
export interface RegisteredAgent {
  id: string;
  label: string;
  color: string;
  session: TeamAgentSession;
  snapshot: TeamAgentSnapshot;
}
```

The existing surfaces remain:

- `AgentTabBar`
- `AgentHeader`
- `AgentChatView`
- `AgentChatContent`
- `AgentComposer`
- `DefaultAppLayout`

The bridge subscribes to each session, updates the projection, and routes
composer and approval actions through the contract. In-process and supervised
teammates therefore appear in the same UI.

The first supervised slice does not need a new fleet grid, raw PTY attach, or a
second roster. Health and terminal reason can land in the existing tab header
and status indicator, complementing
[#9449](https://github.com/QwenLM/qwen-code/issues/9449).

## Persistence and recovery

Recovery is not part of the first supervised slice, but the initial protocol
must avoid making it impossible.

Extend persisted member identity with optional runtime fields:

```ts
export interface TeamMemberRuntimeRef {
  sessionId: string;
  workerId?: string;
  generation: number;
  backend: 'in_process' | 'supervised';
  lifecycle:
    | 'starting'
    | 'running'
    | 'idle'
    | 'failed'
    | 'stopped'
    | 'recoverable';
  lastEventCursor?: number;
}
```

Do not use PID as durable identity. PID can remain diagnostic metadata.

Later recovery flow:

1. read the team and task files;
2. query the supervisor catalog;
3. reconcile members by session ID and generation;
4. attach to live workers;
5. replay events after the persisted cursor;
6. request a full snapshot on replay gaps;
7. mark unconfirmable state failed or recoverable, never completed.

## Workspace and isolation policy

Execution placement and workspace policy are separate:

```ts
export interface TeamAgentExecutionPolicy {
  runtime: 'in_process' | 'dedicated_process';
  workspace:
    | { kind: 'shared'; cwd: string }
    | { kind: 'existing_worktree'; cwd: string }
    | { kind: 'managed_worktree'; baseRef: string };
  sandbox:
    | { kind: 'none' }
    | { kind: 'tool_policy'; profile: string }
    | { kind: 'os_sandbox'; profile: string };
}
```

Recommended `/coordinate` defaults:

- investigators and reviewers: read-only tools, shared checkout;
- writer: one dedicated process in a leader-owned worktree;
- leader: merge authority;
- no claim of security isolation unless an OS sandbox is active.

The first supervised slice may support only shared and existing-worktree
workspaces. Managed worktree recovery is deferred until session recovery is
defined.

## Requirements

### P0

- One contract represents both current in-process and supervised teammate
  sessions.
- Agent View consumes serializable snapshots and events, not backend-specific
  live objects.
- Current in-process Agent Teams behavior remains available and default.
- A feature-gated backend launches one real teammate worker process.
- A worker crash produces a terminal event and does not terminate the leader.
- Clean team deletion stops supervised workers.
- Nested team creation and teammate fan-out remain denied.
- Control credentials do not reach teammate shell children.
- Message submission returns a queued, admitted, or rejected receipt.
- Contract parity tests run against both session implementations.

### P1

- Multiple supervised teammates run concurrently.
- Existing tabs expose transcript, status, tool activity, approvals, and
  composer input.
- Event cursors and worker generations reject stale events.
- A terminated worker's bounded transcript remains inspectable.
- Broadcast returns per-recipient results instead of unconditional success.
- Effective model metadata reflects the model actually used by the worker.
- Clean shutdown and artifact deletion surface partial failures.

### P2

- Leader crash leaves workers available for recovery.
- A new leader process can reattach to a recoverable team.
- Supervisor restart rebuilds projections from worker/session state.
- Managed worktree ownership survives recovery.
- Raw terminal attach is available as a separate presentation capability.
- ACP-backed or remote workers can implement the same vertical worker
  contract.

## Acceptance criteria

### Contract extraction

- Given the default in-process backend, when a teammate is spawned, then its
  existing Agent View tab, transcript, approvals, composer, task behavior, and
  cleanup remain unchanged.
- Given a session contract test suite, when it runs against the in-process
  adapter, then all required snapshot, subscription, submission, approval, and
  terminal behaviors pass.
- Given Agent View code, when reviewed statically, then it does not cast a
  team backend to `InProcessBackend` or require `AgentInteractive`.

### First supervised teammate

- Given supervised mode, when one teammate starts, then the teammate has a
  distinct OS PID and appears in the existing Agent View.
- Given a running supervised teammate, when its worker is killed, then the
  leader remains interactive and the tab shows failed with a reason.
- Given a clean team deletion, when cleanup completes, then no supervised
  teammate remains alive.
- Given a teammate shell tool, when its environment is inspected, then no
  supervisor control credential is present.
- Given a teammate identity, when it attempts nested team creation or named
  teammate spawn, then the request is rejected.

### Message admission

- Given a busy teammate, when a peer sends an ordinary message, then the sender
  receives `queued`, not `sent` or `delivered`.
- Given an idle-boundary message, when the worker admits it into a turn, then
  an `admitted` event with the same input ID is observable.
- Given a worker that terminates before admission, when the queued input is
  reconciled, then it becomes failed or rejected rather than silently
  disappearing.
- Given a broadcast with one terminal recipient, when broadcast finishes, then
  the caller receives per-recipient success and failure instead of
  unconditional “broadcast to all.”

### Recovery foundation

- Given events from an old worker generation, when a replacement worker is
  active, then those events are ignored.
- Given an event cursor gap, when replay is unavailable, then the client
  requests a full snapshot.
- Given uncertain recovery state, when the supervisor cannot prove completion,
  then the session is marked failed or recoverable, never completed.

## Implementation slices

### Slice A: truthful message receipts

Fix current-main behavior before introducing subprocesses:

- return per-recipient broadcast results;
- distinguish queued from immediately admitted;
- add stable input IDs;
- add regression tests for partial broadcast and pre-admission termination.

This is independently valuable and defines the admission semantics needed by
the supervisor.

### Slice B: session projection over the in-process runtime

- introduce `TeamAgentSession` and snapshot/event types;
- implement `InProcessTeamAgentSession`;
- convert Agent View registration to the session contract;
- add one shared contract suite;
- preserve the current feature flag and behavior.

This is a refactoring only where required to satisfy a user-visible contract.
It must not introduce remote, recovery, or provider abstractions.

### Slice C: one supervised read-only teammate

- reuse the current Agent View supervisor infrastructure;
- add the minimum worker entrypoint and protocol operations;
- implement `SupervisedTeamAgentSession`;
- launch one read-only teammate;
- project its transcript into the existing tab;
- enforce credential and nested-fan-out invariants.

This is the go/no-go slice. Do not add multi-worker recovery until it is
dogfooded.

### Slice D: multi-worker lifecycle

- support two or more teammates;
- add per-worker terminal reasons;
- ensure clean leader exit and `team_delete` stop workers;
- preserve tasks and leader routing;
- add process fault injection;
- measure idle CPU and remove periodic worker-control polling before broader
  enablement.

### Slice E: recovery and attachment

- persist session IDs and generations;
- add supervisor catalog and leader lease;
- survive leader crash;
- reattach from a later CLI process;
- add snapshot replay and stale-generation rejection;
- recover worktree ownership without deleting dirty worktrees.

### Slice F: optional surfaces and adapters

- raw terminal attach;
- managed worktree provisioning;
- provider-specific workers;
- ACP as a vertical worker adapter;
- remote transport.

Each item in this slice requires its own user problem and acceptance test.

## Validation strategy

### Contract tests

Run the same tests against in-process and supervised sessions:

- initial snapshot;
- ordered status transitions;
- message queue and admission;
- approvals;
- interrupt and stop;
- terminal reason;
- transcript projection;
- event cursor behavior.

### Fault injection

Test failures at:

- before worker spawn acknowledgement;
- after process spawn but before session registration;
- after queue acceptance but before admission;
- during tool execution;
- during transcript event emission;
- during clean stop;
- during artifact deletion;
- after worker replacement with stale events still in flight.

### Security tests

- worker-scoped capability cannot invoke supervisor-only operations;
- supervisor credential is absent from shell children;
- teammate cannot create a team or spawn a named teammate;
- message sender attribution cannot be forged by payload text;
- read-only tool policy remains enforced.

### UI tests

- in-process and supervised tabs render through the same components;
- failed sessions remain inspectable;
- missing snapshots produce a recoverable error state rather than crashing;
- focus and composer target remain correct across terminal transitions;
- transcript scrolling regression remains covered by
  [#9507](https://github.com/QwenLM/qwen-code/issues/9507).

## Success metrics

Baselines must be measured before enabling supervised mode beyond an
experimental setting.

- Zero leader-process crashes caused by an individual worker crash in the
  fault-injection suite.
- Zero queued inputs reported as delivered before admission.
- Zero stale-generation events applied after worker replacement.
- All in-process session contract tests pass unchanged.
- Supervised mode supports the `/coordinate` acceptance demo without a second
  UI or task implementation.
- Idle CPU for one leader plus three idle workers is measured and accepted
  before wider enablement; periodic 50 ms worker polling is not acceptable.
- Every terminal worker state shown to the leader includes a reason or an
  explicit unknown marker.

## Open questions

- **Blocking, Core owner:** Should the new contract evolve the existing
  `TeamAgentHandle`, or should a narrowly scoped session interface replace it?
- **Blocking, CLI owner:** Which current Agent View supervisor operations can
  be reused without reviving Fleet-specific protocol concepts?
- **Blocking, Security owner:** What is the minimum capability split between
  leader, supervisor, and worker?
- **Blocking, Runtime owner:** Which exact event marks model-turn admission for
  an externally queued teammate message?
- **Non-blocking, Product owner:** Should supervised mode eventually replace
  in-process mode or remain an advanced option?
- **Non-blocking, Runtime owner:** Should a clean leader exit stop teammates
  while only crash recovery preserves them, as proposed in #8842?
- **Non-blocking, UI owner:** Is a roster route needed after terminal status
  and recovery exist, or are existing tabs sufficient?

## Upstream issue campaign

The working issue bodies live in
[`agent-team-durable-runtime-issues/`](agent-team-durable-runtime-issues/).
They are intentionally unfiled and carry explicit evidence and filing gates
for repeated hardening rounds.

The first proposed report is a user-observed custom-model routing defect:
named teammates created from custom agent definitions can keep the requested
model ID while using the leader's content generator. The ordinary subagent
path builds a dedicated runtime content-generator view; the Agent Team path
converts without the active model-resolution context and does not build that
view unless explicit auth overrides are supplied. This should be resolved
before treating team model metadata as authoritative.

The campaign should not manufacture bugs to force an architecture. Every bug
must be independently reproducible on current `main`, valuable if fixed alone,
and linked to the umbrella only when it contributes a reusable contract.

### Filing order

1. File the smallest confirmed correctness bugs first.
2. Cross-link existing current-main issues that already expose lifecycle or
   delivery gaps.
3. File the umbrella after the first new bug is accepted or reproduced.
4. Let the Qwen triage and autofix bots work on narrow issues.
5. Offer small PRs from current `main`; do not revive PR #8869 as one patch.

### Existing issues to cross-link

- [#8172](https://github.com/QwenLM/qwen-code/issues/8172): teammate messages
  wait behind an entire long multi-tool leader turn.
- [#9449](https://github.com/QwenLM/qwen-code/issues/9449): leader-visible
  teammate health and terminal failure notifications.
- [#9450](https://github.com/QwenLM/qwen-code/issues/9450): `task_list` can
  trigger duplicate tool-call detection while team state changes.
- [#9507](https://github.com/QwenLM/qwen-code/issues/9507): teammate tab output
  that scrolls away cannot be recovered.

### Draft packet

The versioned issue bodies, evidence levels, filing gates, and hardening
checklists are maintained in
[`agent-team-durable-runtime-issues/`](agent-team-durable-runtime-issues/).
The packet currently covers:

- custom model routing for named teammates;
- truthful broadcast outcomes;
- effective model and teammate identity metadata;
- observable cleanup failures;
- conditional task assignment;
- generation-safe stale reclaim;
- pre-subscription initial result delivery;
- transactional concurrent spawn membership;
- the backend-neutral session and supervised-runtime RFC.

Queued-message receipt wording remains linked to #8172 rather than becoming a
duplicate issue. PID-only ownership is treated as a documented conservative
limitation, not a bug report.

## Recommendation

The upstream campaign should be transparent. Mention Prime Agent in the
umbrella as prior art, but frame the request around Qwen's current behavior and
the maintainers' own earlier fleet work. Do not label persistence or
subprocess execution itself as a bug because current documentation names those
as non-goals.

Use bugs to establish missing correctness contracts:

- accurate broadcast results;
- accurate effective runtime metadata;
- truthful queue/admission status;
- observable cleanup failure;
- conditional task assignment;
- generation-safe lifecycle mutation;
- transactional spawn and event registration.

Those contracts make a supervised backend smaller and safer. They also remain
valuable if maintainers decide never to ship process-backed teams.
