# Draft: initial teammate result can be lost before event bridge attachment

> Filing status: Not filed
>
> Classification: Bug
>
> Evidence: Deterministic source ordering; fake-backend test required

## Suggested title

Agent Team: a fast initial teammate result can be lost during spawn

## What happened?

`TeamManager.spawnTeammate()` attaches its event bridge only after
`backend.spawnAgent()` resolves. The in-process backend waits for
`AgentInteractive.start()`, which starts the initial run loop before it
returns. A fast initial turn can therefore emit final round text and become
idle before TeamManager begins listening.

Late idle reconciliation flushes pending input but does not recover the
unobserved final text or synthesize the normal no-answer report. The leader
can receive no result for work that completed successfully.

## What did you expect to happen?

Every completed, non-cancelled teammate turn should deliver either:

- its final text; or
- the explicit no-model-visible-final-answer notice.

Spawn timing should not affect this invariant.

## Reproduction

Use a fake backend whose start path emits `ROUND_TEXT("initial result")` and
transitions to `IDLE` before `spawnAgent()` resolves. Spawn the teammate and
drain the leader inbox.

Actual: no automatic report is delivered.

Expected: the leader receives `initial result`.

## Source analysis

- `packages/core/src/agents/team/TeamManager.ts`
  - `spawnTeammate()` awaits backend spawn before `setupEventBridge()`;
  - late idle reconciliation does not replay the last completed round.
- `packages/core/src/agents/backends/InProcessBackend.ts`
  - `spawnAgent()` awaits `interactive.start()`.
- `packages/core/src/agents/runtime/agent-interactive.ts`
  - `start()` begins the initial run loop before resolving.

## Proposed regression test

Add two controlled fake-backend cases:

1. pre-bridge final text plus idle produces one leader report;
2. pre-bridge idle without final text produces the fallback notice.

Also assert that replay does not duplicate events when the bridge was attached
in time.

## Acceptance criteria

- Registration returns an observable handle before execution starts, or the
  backend replays the last completed turn during bridge setup.
- A fast initial result is delivered exactly once.
- A fast no-text completion produces the documented fallback exactly once.
- Normal post-spawn event delivery remains unchanged.

## Before filing

- [ ] Add the fake-backend regression test.
- [ ] Confirm event names and line references on latest `main`.
- [ ] Search for lost initial result and event bridge duplicates.
