# Agent-team reproduction results

## Blank task-list filters

- **Test:** `TaskListTool > treats blank optional filters as omitted`
- **Command:** `cd packages/core && npx vitest run src/tools/task-list.test.ts`
- **Commit base:** `4a281f2efcde865b578bbe09e46f1e311112015a`
- **Failure:** blank `owner` and `blockedBy` filters return `No tasks found.` rather than omitting those optional filters; the nonblank owner control passes.
