# Draft: stale reclaim can delete a newly created live team

> Filing status: Not filed
>
> Classification: Bug
>
> Evidence: Deterministic cross-session check/delete race

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

## Acceptance criteria

- Reclaim is protected by a cross-session lifecycle lock or atomic namespace
  handoff.
- Deletion validates an ownership or generation token.
- A stale reclaim decision cannot delete a later generation.
- The test runs on both POSIX and Windows filesystem implementations.

## Before filing

- [ ] Add a deterministic two-creator test.
- [ ] Choose a minimally prescriptive fix description.
- [ ] Search for stale-team and team-create race duplicates.
- [ ] Include the exact commit used for reproduction.
