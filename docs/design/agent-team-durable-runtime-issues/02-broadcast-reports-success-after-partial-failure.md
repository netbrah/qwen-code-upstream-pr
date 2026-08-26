# Draft: Agent Team broadcast reports success after partial failure

> Filing status: Not filed
>
> Classification: Bug
>
> Evidence: Static source inspection only; runtime behavior not yet reproduced
>
> Readiness: Hold until an invocation-level fault-injection test fails

## Suggested title

Agent Team: broadcast reports success when delivery to one or more teammates fails

## What happened?

Static inspection indicates that `send_message(to: "*")` may report
`Message broadcast to all teammates.` even
when delivery to one or more recipients failed.

`TeamManager.broadcast()` waits with `Promise.allSettled()`, logs rejected
deliveries, and then resolves normally. The `send_message` tool therefore
cannot distinguish complete success from partial or total failure.

## What did you expect to happen?

The tool result should report which recipients accepted the message and which
failed. A total failure should return an error. A partial failure should
return a structured partial-success result that the leader can act on.

## Reproduction

1. Create a team with at least two teammates.
2. Make one teammate address fail deterministically after the recipient list
   is built, for example with a backend test double that rejects delivery for
   one agent ID.
3. Call `send_message(to: "*", message: "checkpoint")`.

Actual: the tool returns `Message broadcast to all teammates.`

Expected: the tool identifies successful and failed recipients and does not
claim complete delivery.

## Source analysis

- `packages/core/src/agents/team/TeamManager.ts`
  - `broadcast()` uses `Promise.allSettled()`.
  - rejected results are logged but not returned or thrown.
- `packages/core/src/tools/send-message.ts`
  - the broadcast branch returns a fixed success message after the promise
    resolves.

## Proposed regression test

Inject three recipients into `broadcast()`:

- one successful delivery;
- one rejected delivery;
- one unavailable member.

Assert the returned result preserves all recipient outcomes and that
`send_message` does not render complete success.

## Acceptance criteria

- A complete broadcast returns all successful recipient IDs.
- A partial broadcast returns both successful and failed recipient IDs.
- A total broadcast failure returns a tool error.
- Logging is supplemental; callers do not need logs to discover failure.

## Before filing

- [ ] Add exact current-main line references.
- [ ] Add a deterministic unit reproduction.
- [ ] Decide whether the smallest fix returns a result object or throws an
      aggregate error.
- [ ] Re-run duplicate search.

<details>
<summary>中文草稿（尚未通过运行时测试复现）</summary>

## 发生了什么？

静态源码检查表明，当一个或多个 teammate 的投递被拒绝时，
`send_message(to: "*")` 仍可能返回
`Message broadcast to all teammates.`。`TeamManager.broadcast()` 使用
`Promise.allSettled()`，记录 rejected 结果后正常返回；工具层随后渲染固定
成功文本。

这不是已复现的运行时缺陷。在提交前，需要一个 invocation 级故障注入测试，
证明 rejected 投递确实会产生完整成功结果。

## 预期行为是什么？

广播结果不应把部分或全部投递失败描述为全部成功。调用方至少应能区分完整
成功、部分失败和全部失败；具体返回结构由维护者决定。

## 客户端信息

提交前添加完整 `/about` 输出、平台和复现所用 commit。

</details>
