# Draft: `team_delete` can hide cleanup failure

> Filing status: Not filed
>
> Classification: Bug
>
> Evidence: Static source inspection; filesystem and backend cleanup outcomes not yet isolated
>
> Readiness: Hold until an injected cleanup failure reproduces the user-visible result

## Suggested title

Agent Team: `team_delete` can report success while team files remain on disk

## What happened?

The team cleanup path uses `Promise.allSettled()` for filesystem deletion and
does not propagate rejected operations. The `team_delete` tool can therefore
report deletion even if a team directory, task file, or mailbox remains.

## What did you expect to happen?

Cleanup should either:

- complete and report success; or
- report the paths that could not be removed and leave a recoverable cleanup
  state.

It should not silently convert filesystem failures into complete success.

## Reproduction to add

Use an injected filesystem adapter or mock to reject removal of one team
directory. Call `team_delete`, then assert:

- the tool does not report complete success;
- the failed path is returned;
- a retry can complete cleanup safely.

## Source analysis

Review:

- `packages/core/src/agents/team/TeamManager.ts`
  - `deleteTeamDirs()`
- the `team_delete` tool implementation and its fixed success result.

## Acceptance criteria

- Partial cleanup failures are visible to the caller.
- Cleanup remains idempotent.
- A retry does not damage a newly created team with the same name.
- Successful cleanup preserves the current user-facing result.

## Before filing

- [ ] Confirm the exact call sequence on current `main`.
- [ ] Add an injected `rm` or permissions failure test.
- [ ] Verify whether Windows and POSIX paths behave differently.
- [ ] Re-run duplicate search.

<details>
<summary>中文草稿（尚未通过故障注入复现）</summary>

## 发生了什么？

静态源码检查表明，Agent Team 清理路径可能记录文件删除失败后继续返回成功。
当前草稿尚未证明 `team_delete` 的公开结果，也尚未把 backend 清理失败与
文件系统删除失败分别隔离。

## 预期行为是什么？

如果清理没有完全成功，调用方应能看到失败，而不应收到完整成功结果。清理
应可安全重试，并且重试不得删除同名的新 team。

## 提交门槛

使用注入的 `rm`/权限失败执行一次工具级测试，记录实际返回值和残留路径，
并分别覆盖 backend 与文件系统清理。

</details>
