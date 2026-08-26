# Draft: Agent Team metadata can report the wrong effective model

> Filing status: Not filed
>
> Classification: Bug
>
> Evidence: Static source inspection; no user-visible mismatch captured
>
> Readiness: Do not file separately unless draft 1 is resolved and the visible mismatch remains

## Suggested title

Agent Team: joined event and member metadata can omit the effective teammate model

## What happened?

When a named teammate selects its model from an agent definition,
`TeamManager.spawnTeammate()` can execute with `subagentModel` while persisting
and emitting `member.model` from only the direct team spawn configuration.
The roster or joined event can therefore show no model, or the wrong model,
even when a model was resolved for execution.

The CLI then introduces a second mismatch: `useTeamInProcess` registers the
teammate name as both `modelId` and `modelName`, ignoring the model carried by
the member or joined event. Agent View fields intended for model identity can
therefore contain teammate identity instead.

## What did you expect to happen?

Agent Team metadata should report the effective resolved model, including
whether it came from:

- an explicit team spawn override;
- the named agent definition;
- the leader through `inherit`.

The UI and event stream should not present a requested model as an effective
model until routing has resolved successfully.

## Reproduction

1. Create a custom agent definition with model frontmatter.
2. Spawn it as a named teammate without a direct `model` argument.
3. Compare the model in the spawn runtime configuration with the model stored
   in the team member and emitted in the joined event.

## Source analysis

In `packages/core/src/agents/team/TeamManager.ts`:

- runtime spawn uses `config.model ?? subagentModel`;
- member metadata is initialized from `config.model`;
- joined events use the member metadata.

In `packages/cli/src/ui/hooks/useTeamInProcess.ts`:

- discovery and join handling pass the teammate name into model ID and model
  name fields;
- `member.model` and `event.model` are not used for registration.

`packages/cli/src/ui/contexts/AgentViewContext.tsx` and the Agent View tab and
header components treat those fields as model metadata.

## Proposed regression test

Cover direct override, named-agent override, inherited model, and unresolved
selector cases. Assert one effective model identity is shared by backend
spawn, persisted membership, events, and Agent View. Add a separate
`displayName` or `agentName` assertion so fixing model metadata does not make
teammates indistinguishable in the tab bar.

## Acceptance criteria

- Metadata reports the resolved effective model and auth type.
- Metadata identifies the source of selection or clearly marks inheritance.
- An unresolved selector is visible as an error or fallback, not silently
  presented as a successful requested route.
- The model-routing fix and metadata fix share one resolution function.
- Teammate identity and model identity occupy separate UI fields.

## Filing decision

Prefer including this as an acceptance criterion or companion PR test for the
custom-model routing issue. File separately only if runtime routing is fixed
but the UI and roster remain incorrect.

<details>
<summary>中文审阅说明</summary>

静态检查发现，运行时选择的模型、持久化 member metadata，以及 Agent View
注册字段之间可能存在差异。但目前没有捕获用户可见的错误输出，而且 UI
字段也可能是有意显示 teammate 身份。此项不应作为独立 bug 提交；优先把它
作为模型路由报告的验证条件。只有在路由修复后仍能复现错误显示，才考虑单独
报告。

</details>
