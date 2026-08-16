# Agent-team reproduction results

## Blank task-list filters

- **Tests:** `TaskListTool > treats a blank owner filter as omitted`; `TaskListTool > treats a blank blockedBy filter as omitted`
- **Command:** `cd packages/core && npx vitest run src/tools/task-list.test.ts`
- **Commit base:** `4a281f2efcde865b578bbe09e46f1e311112015a`
- **Controls:** seven tests pass, including omitted optional filters and a selective nonblank owner filter.
- **Failures:** each independent request returns `No tasks found.`: `{ status: 'pending', owner: '' }` and `{ status: 'pending', blockedBy: '' }` both fail to return the pending task.
- **Scope:** this branch encodes the caller-facing contract that blank optional strings behave as omitted values. An upstream resolution could instead reject blanks or define an explicit empty-string query, but it must not silently return an empty board while the tool description treats the filter as absent.
