# Agent Team Reproduction Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` or `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish one `main`-based, test-only branch that deterministically demonstrates each confirmed agent-team defect without including production fixes.

**Architecture:** Tests remain collocated with their source boundaries and use the existing Vitest and team coordination harnesses. The branch deliberately contains RED tests for confirmed bugs, green controls that protect correct behavior, and a concise evidence document that maps each test command to a separate upstream issue.

**Tech Stack:** TypeScript, Vitest, existing `TeamCoordinationHarness`, existing OpenAI converter tests.

**Spec:** `docs/design/agent-team-runtime-investigation.md` in the investigation checkout; this branch carries only reproducible evidence and its execution record.

## Global Constraints

- Base all work on `main`; do not copy dogfood changes.
- Modify tests and reproduction documentation only; do not change production logic.
- Capture actual RED output before committing each failing regression test.
- Keep one deliberately passing control beside every RED assertion.
- Do not include prompts, reports, mailbox contents, session IDs, or absolute user paths in committed evidence.
- Do not claim that idle-only delivery is a defect until product behavior is decided.

---

### Task 1: Blank Task-List Filter Reproduction

**Files:**
- Modify: `packages/core/src/tools/task-list.test.ts`
- Create: `docs/design/2026-08-16-agent-team-reproduction-results.md`

**Interfaces:**
- Consumes: `TaskListTool.build({ status?, owner?, blockedBy? })`
- Produces: two independent failing regression tests proving a blank `owner` or `blockedBy` string is interpreted as a literal filter rather than omitted.

- [x] **Step 1: Write isolated RED tests and independent controls**

The passing control omits optional filters and verifies a nonblank owner filter remains selective. The two RED tests each supply only one blank optional field:

```ts
it('treats a blank owner filter as omitted', async () => {
  const result = await tool.build({ status: 'pending', owner: '' })
    .execute(new AbortController().signal);
  expect(result.llmContent).toContain(pending.subject);
});

it('treats a blank blockedBy filter as omitted', async () => {
  const result = await tool.build({ status: 'pending', blockedBy: '' })
    .execute(new AbortController().signal);
  expect(result.llmContent).toContain(pending.subject);
});
```

- [x] **Step 2: Run the focused test and capture RED evidence**

Run:

```bash
cd packages/core && npx vitest run src/tools/task-list.test.ts
```

Observed: 7 passing controls and 2 failures. Both blank-filter requests returned `No tasks found.` rather than listing the pending task.

- [x] **Step 3: Record the failing assertions in the results document**

Record only the test names, command, commit base, and failure summaries. Do not paste temporary directories or task bodies.

- [ ] **Step 4: Review the corrected test-only diff and commit it**

The preceding combined-filter test commit is superseded by this correction. Preserve no combined-filter assertion in the final branch diff.

### Task 2: Manual Assignment Dispatch Reproduction

**Files:**
- Modify: `packages/core/src/tools/team-lifecycle.test.ts`
- Modify: `docs/design/2026-08-16-agent-team-reproduction-results.md`

**Interfaces:**
- Consumes: leader `TaskUpdateTool` and `TeamManager.spawnTeammate()`.
- Produces: a failing test that a documented leader assignment sends exactly one task prompt to the named idle teammate.

**Contract decision:** the current leader-facing instructions promise that setting an idle teammate as owner assigns the task to that teammate. This RED test pins that dispatch behavior. Replacing it with rejection is a separate product-contract change that must update the instructions and its regression coverage.

- [x] **Step 1: Write the failing lifecycle test**

Create and reserve the task before spawning Alice, so auto-claim cannot consume it. Spawn idle `alice`, then route the assignment through the leader tool:

```ts
await exec(taskUpdateTool, {
  taskId,
  status: 'in_progress',
  owner: 'alice',
});
```

Assert that Alice receives exactly one task prompt naming `taskId`. This isolates manual leader assignment from pending-task auto-claim.

- [x] **Step 2: Add a passing control**

Use the existing `SendMessageTool` path in a separate test to send Alice a direct message and assert that the fake agent receives it. This demonstrates that the harness and idle delivery are live before the RED case runs.

- [x] **Step 3: Run and record RED evidence**

Run:

```bash
cd packages/core && npx vitest run src/tools/team-lifecycle.test.ts
```

Observed: six controls pass, including direct leader delivery. The assignment test fails because `task_update` persists `in_progress` ownership but does not enqueue a task prompt.

- [ ] **Step 4: Review and commit the RED test**

```bash
git add packages/core/src/tools/team-lifecycle.test.ts docs/design/2026-08-16-agent-team-reproduction-results.md
git commit -m "test(team): reproduce stranded manual assignment"
```

### Task 3: Prompt Contract and Peer-Visibility Reproduction

**Files:**
- Modify: `packages/core/src/agents/team/promptAddendum.test.ts`
- Modify: `packages/core/src/tools/team-create.test.ts`
- Modify: `docs/design/2026-08-16-agent-team-reproduction-results.md`

**Interfaces:**
- Consumes: `buildTeammatePromptAddendum()` and team-create instructional text.
- Produces: independent failing tests for stale final-delivery wording and an unsupported peer-summary promise.

**Contract decision:** the runtime automatically forwards an unreported final answer when a teammate becomes idle. Normal and plan-required prompts must say so, and must reserve explicit `send_message` for intentional interim communication. The leader-facing peer-DM summary promise is unsupported and must be removed; this evidence branch does not require a new leader-observability feature.

- [x] **Step 1: Write isolated prompt-contract assertions**

The normal profile must state automatic final delivery and must not call explicit reporting the only delivery path. The plan-required profile must state automatic final delivery. The read-only profile is a separate passing control because it already describes automatic forwarding.

- [x] **Step 2: Write a failing peer-visibility assertion**

```ts
expect(tool.description).not.toContain(
  'a brief summary is included in their idle notification',
);
```

This pins removal of an unsupported promise rather than a runtime implementation choice.

- [x] **Step 3: Run and record RED evidence**

Run:

```bash
cd packages/core && npx vitest run src/agents/team/promptAddendum.test.ts src/tools/team-create.test.ts
```

Observed: 12 controls pass and four independent assertions fail: normal automatic-delivery wording, normal “ONLY way” wording, plan-required automatic-delivery wording, and the peer-summary promise.

- [ ] **Step 4: Review and commit the RED tests**

```bash
git add packages/core/src/agents/team/promptAddendum.test.ts packages/core/src/tools/team-create.test.ts docs/design/2026-08-16-agent-team-reproduction-results.md
git commit -m "test(team): reproduce stale communication prompts"
```

### Task 4: Provider Tool-Contract Characterization

**Files:**
- Modify: `packages/core/src/core/openaiContentGenerator/converter.test.ts`
- Create or modify the existing Responses/Anthropic converter test nearest its function-schema serialization path
- Modify: `docs/design/2026-08-16-agent-team-reproduction-results.md`

**Interfaces:**
- Consumes: the actual `send_message` function declaration schema.
- Produces: provider-specific assertions that report whether optional properties are preserved or a closed object can force `type: 'shutdown_request'`.

- [ ] **Step 1: Add a passing source-schema control**

Instantiate `SendMessageTool`, inspect its declaration, and assert:

```ts
expect(parameters.required).toEqual(['message']);
expect(parameters.properties.type).toMatchObject({
  enum: ['shutdown_request'],
});
```

- [ ] **Step 2: Add provider-wire assertions**

For each provider path that serializes the actual declaration, assert that optional `type` is not advertised as required. Where the current path preserves `additionalProperties: false` and cannot guarantee optional-field compatibility, make the test RED and record that as an unprotected boundary rather than claiming it reproduces a particular remote gateway.

- [ ] **Step 3: Run focused converter tests and record exact outcomes**

Run the smallest package-local Vitest command for the touched converter files. Record which tests are green controls and which paths are RED.

- [ ] **Step 4: Commit the characterization tests**

```bash
git add packages/core/src/core/openaiContentGenerator/converter.test.ts docs/design/2026-08-16-agent-team-reproduction-results.md
git commit -m "test(team): characterize message schema serialization"
```

### Task 5: Result-Delivery Characterization (No Product Assertion Yet)

**Files:**
- Modify: `packages/cli/src/ui/hooks/useGeminiStream.test.tsx`
- Modify: `docs/design/2026-08-16-agent-team-reproduction-results.md`

**Interfaces:**
- Consumes: the TeamManager leader-message callback and the UI notification queue.
- Produces: green characterization tests proving results stay queued while the leader is busy and arrive exactly once after normal idle or cancellation.

- [ ] **Step 1: Add a busy-to-idle control**

Start an unresolved foreground request, invoke the leader-message callback, assert no history notification before idle, resolve the foreground request, and assert exactly one teammate notification/submission.

- [ ] **Step 2: Add a busy-to-cancel control**

Repeat the setup, cancel the foreground request, then assert exactly one queued teammate notification/submission.

- [ ] **Step 3: Run and record green characterization evidence**

Run:

```bash
cd packages/cli && npx vitest run src/ui/hooks/useGeminiStream.test.tsx
```

Expected: PASS if the existing idle-only policy works as designed. If it fails, stop and classify that separate unexpected result before adding an upstream claim.

- [ ] **Step 4: Commit the characterization tests**

```bash
git add packages/cli/src/ui/hooks/useGeminiStream.test.tsx docs/design/2026-08-16-agent-team-reproduction-results.md
git commit -m "test(team): characterize deferred result delivery"
```

### Task 6: Validate, Push, and Attach Evidence

**Files:**
- Modify: `docs/design/2026-08-16-agent-team-reproduction-results.md`

**Interfaces:**
- Consumes: the individual RED/green command results.
- Produces: a single committed evidence index and a pushed fork branch for issue links.

- [ ] **Step 1: Run every touched package-local test command**

Preserve expected RED failures. Do not use `--update`, do not weaken assertions, and do not run broad root-level Vitest.

- [ ] **Step 2: Review the full test-only diff**

Run:

```bash
git diff main...HEAD -- packages/core packages/cli docs/design
```

Confirm no production source is changed and no sensitive runtime artifact is included.

- [ ] **Step 3: Commit the evidence index and push the branch**

```bash
git add docs/design/2026-08-16-agent-team-reproduction-results.md
git commit -m "docs(team): index reproducible coordination failures"
git push -u pr-fork agent-team-red-repros
```

- [ ] **Step 4: Create separate, cross-linked upstream issues**

Each report links the immutable evidence commit and names the exact test command. Use `Related to #9276` only where the report/communication contract is causally related. Keep task lifecycle, prompt/peer contract, and idle-only delivery classification separate.
