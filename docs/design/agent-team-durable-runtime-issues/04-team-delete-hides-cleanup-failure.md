# Draft: `team_delete` can hide cleanup failure

> Filing status: Not filed
>
> Classification: Bug
>
> Evidence: Source-supported; requires injected failure reproduction

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
