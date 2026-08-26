# Draft: stale reclaim can delete a newly created live team

> Filing status: Not filed
>
> Classification: Bug
>
> Evidence: Source-supported cross-session interleaving; not reproduced
>
> Readiness: Hold until a controlled two-creator test deletes the later generation

## Suggested title

Agent Team: concurrent stale reclaim can delete a newly created live team

## What happened?

Two creators can inspect the same stale team generation, independently decide
that it is reclaimable, and then delete by team name. One creator can delete
the stale generation and create a new live team before the second creator
executes its already-authorized namespace deletion. The second deletion then
removes the newly created live generation.

## What did you expect to happen?

Reclaim should delete only the generation that was inspected. Exactly one
creator should acquire a team name, and the winner's configuration and tasks
should remain intact.

## Reproduction

1. Leave team `T` with a dead leader PID.
2. Start creators A and B concurrently.
3. Pause both after they read the stale configuration.
4. Let A delete the stale namespace and create a new live configuration.
5. Let B continue its stale deletion.

### Actual result

B deletes A's newly created team namespace and may then create its own.

### Expected result

B's reclaim fails because the generation at the path no longer matches the
generation it inspected.

## Source analysis

- `packages/core/src/tools/team-create.ts`
  - each creator seeing `EEXIST` independently attempts reclaim.
- `packages/core/src/agents/team/teamHelpers.ts`
  - `tryReclaimStaleTeam()` separates ownership check from deletion;
  - `deleteTeamDirs()` deletes the namespace by name without generation
    validation.

## Proposed regression test

Add barriers around read, delete, and exclusive create for two
`TeamCreateInvocation` instances. Force both to inspect the stale generation,
allow A to create, then allow B to continue. Assert:

- exactly one creator succeeds;
- the winner's session or generation token remains on disk;
- the loser cannot delete the winner's tasks or mailbox.

## Invariant to verify

- A stale reclaim decision cannot delete a later generation.
- The test runs on both POSIX and Windows filesystem implementations.

## Before filing

- [ ] Add a deterministic two-creator test.
- [ ] Choose a minimally prescriptive fix description.
- [ ] Search for stale-team and team-create race duplicates.
- [ ] Include the exact commit used for reproduction.

<details>
<summary>中文草稿（尚未通过双创建者测试复现）</summary>

## 发生了什么？

源码允许两个创建者先后检查同一个 stale team，并分别继续按 team 名称执行
删除。理论上，创建者 A 可以先创建新 generation，随后创建者 B 的旧删除
决定可能删除这个新 generation。该交错尚未在测试中执行。

## 预期行为是什么？

基于 stale generation 作出的 reclaim 决定不能删除之后创建的 live
generation。并发创建结束后，应保留唯一成功创建者的配置、tasks 和 mailbox。

## 提交门槛

需要一个有明确 barrier 的双创建者集成测试，记录每次读取、删除和创建的
顺序。公开报告只陈述生命周期不变量，不规定 lock 或 generation token 的
具体实现。

</details>
