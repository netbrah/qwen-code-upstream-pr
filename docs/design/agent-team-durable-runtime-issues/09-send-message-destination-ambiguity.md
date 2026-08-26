# Draft: `send_message` misroutes ambiguous teammate destinations

> Filing status: Not filed
>
> Classification: Bug
>
> Evidence: User-observed symptom plus deterministic source routing

## Suggested title

Agent Team: `send_message` treats teammate names as background task IDs and
silently prioritizes `task_id` over `to`

## What happened?

An Agent Team teammate attempted to message another named teammate, but the
tool call placed the teammate name in `task_id` rather than `to`. The result
was a background-task error:

```text
Error: No background task found with ID "qa-reviewer".
Task not found.
```

The error does not explain that `qa-reviewer` is an active Agent Team
teammate or that teammate messages use `to`. A second ambiguous form is also
accepted: when a call supplies both `to` and `task_id`, `send_message`
silently selects the background-task route and ignores `to`.

This is easy for a model to produce because one tool combines two different
address spaces:

- Agent Team members are addressed by canonical teammate name through `to`;
- ordinary background agents are addressed by opaque task ID through
  `task_id`.

## What did you expect to happen?

`send_message` should reject an ambiguous call containing both destination
fields. When a failed `task_id` is also the name of an active teammate, the
error should identify the namespace mistake and tell the caller to use `to`.

The tool should never silently ignore one supplied destination.

## Reproduction

1. Create an Agent Team.
2. Spawn two named teammates:
   - `source-reviewer`
   - `qa-reviewer`
3. From `source-reviewer`, invoke:

   ```json
   {
     "task_id": "qa-reviewer",
     "message": "Can you verify the failing test?"
   }
   ```

4. Observe the result.

### Actual result

```text
Error: No background task found with ID "qa-reviewer".
Task not found.
```

The caller receives no correction even though `qa-reviewer` is an active,
addressable teammate.

5. Invoke the ambiguous form:

   ```json
   {
     "to": "qa-reviewer",
     "task_id": "missing-background-task",
     "message": "Can you verify the failing test?"
   }
   ```

6. Observe that the invocation follows the `task_id` branch, reports a missing
   background task, and never attempts teammate delivery.

### Expected result

For the first call:

```text
"qa-reviewer" is an Agent Team teammate, not a background task.
Use to: "qa-reviewer" instead of task_id.
```

For the second call:

```text
Provide exactly one destination: "to" for an Agent Team teammate or
"task_id" for an ordinary background agent.
```

## Client information

<details>
<summary>Client Information</summary>

```console
$ qwen /about
# Add output from the reproducing build before filing.
```

</details>

Platform: Add before filing.

## Source analysis

`SendMessageInvocation.execute()` chooses the background-task path whenever
`params.task_id` is truthy. It does this before obtaining `TeamManager` or
reading `params.to`. Therefore:

1. a teammate name supplied as `task_id` is looked up only in
   `BackgroundTaskRegistry`;
2. a call containing both fields always chooses `task_id`;
3. a valid `to` value is silently ignored;
4. a failed task lookup cannot provide a team-aware correction.

Relevant code:

- `packages/core/src/tools/send-message.ts`
  - `SendMessageParams`
  - `SendMessageInvocation.execute()`
  - `SendMessageTool` input schema
- `packages/core/src/agents/team/TeamManager.ts`
  - `sendMessage()`
- `packages/core/src/agents/team/teamHelpers.ts`
  - `findMemberByName()`
  - `sanitizeName()`

The input schema requires only `message`; both destination properties remain
optional and can coexist. A top-level JSON Schema `oneOf` is not a portable
fix. [#7984](https://github.com/QwenLM/qwen-code/issues/7984) established that
Anthropic-backed models reject top-level `oneOf`, `allOf`, and `anyOf` in tool
input schemas. The robust fix belongs in runtime validation and diagnostics,
with descriptive schema text retained as model guidance.

## Why this is distinct from existing reports

[#7984](https://github.com/QwenLM/qwen-code/issues/7984) concerned a provider
rejecting the entire tool schema. It was fixed by removing the incompatible
top-level `oneOf`. This report does not request restoring that schema.

[#9276](https://github.com/QwenLM/qwen-code/issues/9276) concerned teammates
being unable to send ordinary messages to the leader. This report concerns
destination namespace ambiguity and silent branch precedence after teammate
messaging is available.

No open or closed issue matching `send_message teammate task_id`,
`No background task found`, `Teammate not found`, or peer-message routing was
found on 2026-08-25.

## Proposed regression tests

Add focused `SendMessageInvocation` tests with an active `TeamManager` and a
background-task registry:

1. `to` only routes to the named teammate.
2. `task_id` only routes to the background agent.
3. both fields return a validation error and invoke neither destination.
4. neither field returns the existing missing-destination error.
5. an unknown `task_id` matching an active canonical teammate name returns a
   corrective `use "to"` diagnostic.
6. an unknown `task_id` that matches no teammate retains the ordinary
   background-task-not-found diagnostic.
7. an unsanitized human name such as `QA Reviewer`, when recognized as the
   active teammate `qa-reviewer`, produces the same corrective diagnostic.

The tests should assert not only returned text but also that no message was
queued to the wrong control plane.

## Acceptance criteria

- A call containing both `to` and `task_id` fails without delivering to either
  destination.
- A failed `task_id` lookup that matches an active teammate returns a
  team-aware correction using the canonical teammate name.
- A valid teammate call continues to accept a bare name through `to` and `*`
  for broadcast.
- A valid background-agent call continues to accept `task_id`.
- The fix does not add a top-level schema composition keyword rejected by
  Anthropic-backed providers.
- Error results distinguish Agent Team teammate names from ordinary
  background-task IDs.

## Before filing

- [ ] Capture the exact sanitized tool call and result from a real session.
- [ ] Add `/about` output, platform, and exact commit.
- [ ] Confirm whether the model supplied only `task_id` or supplied both
  destination fields.
- [ ] Add or link a minimal failing test branch if available.
- [ ] Re-run duplicate search.
