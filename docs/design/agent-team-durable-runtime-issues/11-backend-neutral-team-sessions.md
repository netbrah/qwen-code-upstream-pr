# Draft: backend-neutral Agent Team sessions and supervised workers

> Filing status: Not filed
>
> Classification: Feature request / RFC
>
> Evidence: Architecture analysis and recurring concrete boundary failures
>
> Filing gate: Harden and file at least one concrete vertical bug first

## Suggested title

RFC: decouple Agent Team sessions from `InProcessBackend` and Agent View objects

## What would you like to be added?

Introduce a backend-neutral `TeamAgentSession` contract that exposes
transport-safe snapshots, events, input admission, cancellation, and
transcript access. Adapt `InProcessBackend` first, then add an optional local
supervisor backend that runs teammates in separate worker processes without
changing `/coordinate`, `TeamManager`, team tools, tasks, or Agent View.

The first vertical slice should only:

1. replace Agent View's direct `AgentInteractive` dependency with the session
   contract;
2. make queued, admitted, failed, and terminal states explicit;
3. prove one process-backed teammate can satisfy the same contract tests as
   an in-process teammate.

Persistence, reattach, PTY takeover, remote workers, and broader fleet
management should remain follow-up work.

## Why is this needed?

Current Agent Teams have a useful coordination plane but couple runtime,
transport, and UI:

- teammates run inside the leader process;
- Agent View stores live `AgentInteractive` objects;
- teammate messages can only acknowledge an in-memory queue operation;
- a process failure cannot be isolated or represented as a reconnectable
  session boundary.

Several concrete issues expose parts of this boundary:

- [#8172](https://github.com/QwenLM/qwen-code/issues/8172) tracks messages
  waiting behind long multi-tool turns.
- [#9449](https://github.com/QwenLM/qwen-code/issues/9449) tracks
  leader-visible teammate health and terminal failures.
- The accompanying draft reports model-route divergence between ordinary and
  team subagents.
- The accompanying broadcast draft shows that delivery success is not
  represented precisely.

A session contract addresses these incrementally without replacing the
existing team coordinator.

## Relationship to earlier Fleet work

This proposal does not ask to reopen
[#8841](https://github.com/QwenLM/qwen-code/issues/8841) or
[PR #8869](https://github.com/QwenLM/qwen-code/pull/8869). Those changes
combined lifecycle, persistence, protocol, UI, and terminal behavior in a
large branch. The proposed route follows the closing guidance: return from
current `main` with smaller, testable vertical slices driven by concrete
in-process limitations.

## ACP boundary

ACP may be used vertically to connect Qwen to a heterogeneous worker. It
should not become the horizontal Agent Team protocol. Team membership, task
ownership, peer addressing, delivery receipts, cancellation, and trust policy
remain Qwen coordination semantics.

## Optional prior art

Prime Agent demonstrates a useful separation between a client, authenticated
local supervisor, worker-owned session runtime, and transport-safe connection
projection. It is prior art for the boundary, not a dependency and not a
request to import its implementation.

## Acceptance criteria for the first slice

- Agent View renders an in-process teammate without holding an
  `AgentInteractive` reference.
- The same contract test suite runs against in-process and supervised session
  adapters.
- Input submission returns a receipt that distinguishes queued, admitted,
  rejected, and failed.
- A worker crash produces a terminal event without terminating the leader.
- TeamManager remains authoritative for membership, routing, tasks, and
  shutdown policy.
- The existing in-process backend remains the default.

## Additional context

Full design:
`docs/design/2026-08-25-agent-team-durable-runtime.md`

## Before filing

- [ ] Harden and file at least one concrete bug first.
- [ ] Reduce the first slice to the smallest maintainer-reviewable diff.
- [ ] Confirm names against current backend and Agent View interfaces.
- [ ] Add a contract-test sketch.
- [ ] Decide whether to mention Prime Agent in the public version.
- [ ] Re-run duplicate search and re-read the latest Fleet maintainer guidance.
