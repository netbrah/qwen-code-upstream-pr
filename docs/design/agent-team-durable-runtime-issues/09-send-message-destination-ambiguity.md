# Draft: `send_message` misroutes ambiguous teammate destinations

> Filing status: Not filed
>
> Classification: Bug
>
> Evidence: User-observed diagnostic plus static source inspection
>
> Readiness: Hold until the exact observed tool call establishes which destination fields were supplied

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

Searches run on 2026-08-25 included `send_message teammate task_id`,
`No background task found`, `Teammate not found`, and peer-message routing.
Re-run them before filing; the current draft does not claim no duplicate
exists.

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

<details>
<summary>中文草稿（提交前需要确认原始 tool call）</summary>

## 发生了什么？

一次 Agent Team 会话中，向命名 teammate 发送消息时返回：

```text
Error: No background task found with ID "qa-reviewer".
Task not found.
```

目前尚未保存原始 tool call，因此不能确定模型只提供了 `task_id`，还是同时
提供了 `to` 和 `task_id`。源码检查表明，只要 `task_id` 为 truthy，执行
路径会优先查询普通 background task，并可能忽略 `to`。这段分析不能替代
对实际调用参数的确认。

## 预期行为是什么？

同时提供 `to` 和 `task_id` 的调用应被拒绝，而不是静默忽略一个 destination。
如果未知 `task_id` 恰好是 active teammate 的规范名称，错误信息可以指出
namespace 不匹配；这一诊断增强应与“两个字段同时出现”的验证缺陷分开评估。

## 客户端信息

提交前添加完整 `/about` 输出、平台、安装方式和精确 commit。

## 还需要知道什么？

不得建议恢复 top-level JSON Schema `oneOf`，因为 #7984 已记录相关 provider
兼容性问题。公开报告必须附上经过脱敏的原始 tool call 和返回值。

</details>
