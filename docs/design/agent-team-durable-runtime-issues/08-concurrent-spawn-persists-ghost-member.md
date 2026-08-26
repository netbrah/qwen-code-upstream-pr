# Draft: concurrent failed spawn can persist a ghost member

> Filing status: Not filed
>
> Classification: Bug
>
> Evidence: Source-supported shared-roster interleaving; not reproduced
>
> Readiness: Hold until controlled backend and persistence barriers demonstrate divergence

## Suggested title

Agent Team: failed concurrent spawn can leave a ghost member in `config.json`

## What happened?

Concurrent teammate spawns mutate one shared in-memory member array before
either backend spawn completes. A successful spawn can persist a roster that
already includes a still-pending teammate. If the pending spawn then fails,
its rollback removes the member only in memory and does not repair the
persisted roster.

The team file can list a teammate that never joined and has no backend handle.

## What did you expect to happen?

After every spawn resolves or rejects, persisted membership should match
committed backend membership. Failed reservations should not be discoverable
as active or historical teammates.

## Reproduction

1. Start teammate spawns A and B concurrently.
2. Both reserve entries in the shared member array.
3. Let A complete and persist the array containing A and B.
4. Reject B after A's write.
5. Compare disk and in-memory membership.

Actual: disk can still list B.

Expected: both views list only A.

## Source analysis

- `packages/core/src/agents/team/TeamManager.ts`
  - `spawnTeammate()` appends membership before awaiting backend start;
  - successful spawn persists the whole shared roster;
  - rollback removes the failed member in memory but does not persist a
    compensating transaction.
- `packages/core/src/agents/team/teamHelpers.ts`
  - `writeTeamFile()` serializes the shared object state visible at write time.

## Proposed regression test

Use backend barriers so A resolves and its write completes while B remains
pending. Reject B, then assert:

- disk membership equals `manager.getTeamFile().members`;
- B is absent;
- capacity and Agent View discovery do not count B.

## Invariant to verify

- Persistence includes only committed members.
- Concurrent successful spawns remain supported.
- A failed spawn cannot overwrite or erase another concurrent commit.

## Before filing

- [ ] Add controlled backend and write barriers.
- [ ] Confirm whether a narrow serialized roster mutation is sufficient.
- [ ] Search for ghost member and failed spawn duplicates.

<details>
<summary>中文草稿（尚未通过并发测试复现）</summary>

## 发生了什么？

源码中的并发 spawn 共享一个 member array。一个成功 spawn 可能持久化仍在
pending 的另一个 member；如果后者随后失败，其内存回滚可能没有修复已写入
的 roster。这个交错尚未通过受控测试执行。

## 预期行为是什么？

所有 spawn 完成后，磁盘 roster、内存 membership 和实际 backend handle
应一致。失败的 spawn 不应留下可发现的 ghost member。

## 提交门槛

必须用 backend 与写入 barrier 固定执行顺序，并同时断言磁盘、内存、容量
计算和 Agent View discovery。公开报告不规定 reservation/commit 的具体
实现。

</details>
