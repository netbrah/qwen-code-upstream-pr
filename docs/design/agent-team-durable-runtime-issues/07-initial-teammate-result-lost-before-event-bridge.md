# Draft: initial teammate result can be lost before event bridge attachment

> Filing status: Not filed
>
> Classification: Bug
>
> Evidence: Source-supported ordering risk; no lost result has been reproduced
>
> Readiness: Hold until a controlled pre-bridge event test fails

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

<details>
<summary>中文草稿（尚未复现结果丢失）</summary>

## 发生了什么？

静态检查显示，`spawnTeammate()` 在 `backend.spawnAgent()` 返回后才安装
event bridge，而 in-process backend 的 `start()` 可能已开始初始 run。
因此快速完成的初始结果可能在 bridge 安装前发出。当前还没有测试证明该结果
实际丢失。

## 预期行为是什么？

每个成功完成且未取消的 teammate turn 都应向 leader 交付 final text，或
交付明确的无可见答案通知，并且只能交付一次。

## 提交门槛

使用 fake backend 在 `spawnAgent()` resolve 前发出 `ROUND_TEXT` 和
`IDLE`，随后检查 leader inbox；还要有一个 bridge 及时安装的对照，防止
修复产生重复报告。

</details>
