# Agent-team reproduction results

## Blank task-list filters

- **Tests:** `TaskListTool > treats a blank owner filter as omitted`; `TaskListTool > treats a blank blockedBy filter as omitted`
- **Command:** `cd packages/core && npx vitest run src/tools/task-list.test.ts`
- **Commit base:** `4a281f2efcde865b578bbe09e46f1e311112015a`
- **Controls:** seven tests pass, including omitted optional filters and a selective nonblank owner filter.
- **Failures:** each independent request returns `No tasks found.`: `{ status: 'pending', owner: '' }` and `{ status: 'pending', blockedBy: '' }` both fail to return the pending task.
- **Scope:** this branch encodes the caller-facing contract that blank optional strings behave as omitted values. An upstream resolution could instead reject blanks or define an explicit empty-string query, but it must not silently return an empty board while the tool description treats the filter as absent.

## Manual leader assignment

- **Test:** `Team lifecycle E2E > dispatches a task prompt after a leader assigns an idle teammate`
- **Command:** `cd packages/core && npx vitest run src/tools/team-lifecycle.test.ts`
- **Branch base:** `4a281f2efcde865b578bbe09e46f1e311112015a` (`main`)
- **Prior evidence checkpoint:** `40884c312cf8c436d7827704b714cee6fc22b511` (`test(team): isolate blank task filter repro`)
- **Control:** `Team lifecycle E2E > delivers direct leader messages to an idle teammate` passes.
- **Failure:** after the leader assigns a pre-reserved task to idle Alice with `task_update({ status: 'in_progress', owner: 'alice' })`, Alice receives zero messages instead of one task prompt. The test run has six passing controls and this single failure.
- **Scope:** current leader-facing instructions promise that assigning an idle teammate as owner dispatches the work, so this branch pins that behavior. An upstream rejection design would be a separate contract change requiring updated leader instructions and regression coverage; it cannot silently persist a stranded assignment that the pending-only auto-claim path cannot deliver.
