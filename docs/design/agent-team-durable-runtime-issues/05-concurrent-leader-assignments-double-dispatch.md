# Draft: concurrent leader assignments can double-dispatch one task

> Filing status: Not filed
>
> Classification: Bug
>
> Evidence: Deterministic source interleaving; barrier test required

## Suggested title

Agent Team: concurrent leader assignments can dispatch one task to two teammates

## What happened?

Two concurrent leader-side `task_update` calls can both assign and dispatch
the same pending task to different teammates. The task file records only the
last owner, while both teammates receive prompts and may execute concurrently.

## What did you expect to happen?

Task assignment should be a conditional state transition. Exactly one
assignment should commit, and only the committed owner should receive the
task prompt.

## Reproduction

1. Create pending, unowned task `1`.
2. Start active teammates `alice` and `bob`.
3. Run these leader operations concurrently:

   ```text
   task_update({ taskId: "1", status: "in_progress", owner: "alice" })
   task_update({ taskId: "1", status: "in_progress", owner: "bob" })
   ```

4. Force both invocations to read the pending, unowned snapshot before either
   write commits.

### Actual result

The writes serialize but both succeed. Each invocation dispatches to the owner
it requested, while the task file retains only the last owner.

### Expected result

One conditional update wins. Only the persisted owner receives a dispatch.

## Source analysis

- `packages/core/src/tools/task-update.ts`
  - derives the transition and dispatch decision from an unlocked pre-update
    snapshot;
  - leader updates omit `callerName`;
  - dispatch occurs after each successful last-writer-wins update.
- `packages/core/src/agents/team/tasks.ts`
  - the per-task lock serializes writes;
  - ownership conflict checks apply to teammate claims, not unconditional
    leader writes.
- `packages/core/src/agents/team/TeamManager.ts`
  - `dispatchAssignedTask()` does not revalidate current ownership at enqueue.

## Proposed regression test

Use a barrier so two `TaskUpdateInvocation` instances read the same initial
snapshot. Release both and assert:

- exactly one conditional transition succeeds; or
- at minimum, only the final persisted owner receives a prompt.

The stronger contract is preferable because it gives the losing leader call
an explicit conflict result.

## Acceptance criteria

- Assignment compares expected owner, status, and version under the task lock.
- Only the committed transition produces a dispatch.
- The losing invocation returns a conflict that includes current task state.
- Concurrent assignment cannot cause two teammates to execute one task.
- Single-assignment behavior remains unchanged.

## Before filing

- [ ] Add barrier-controlled failing test.
- [ ] Capture exact current-main line references.
- [ ] Search for duplicate assignment-race reports.
- [ ] Keep the issue scoped to conditional assignment, not a full task-store
      redesign.
