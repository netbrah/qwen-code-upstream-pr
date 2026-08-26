# Draft: Agent Team named teammates ignore custom model routes

> Filing status: Not filed
>
> Classification: Bug
>
> Evidence: User-observed behavior plus source-supported root-cause hypothesis

## Suggested title

Agent Team: named teammates ignore custom model routes from agent definitions

## What happened?

A custom agent definition under `.qwen/agents/` selects a model configured in
`settings.json`. Launching that definition as an ordinary subagent routes to
the selected model correctly. Launching the same definition as a named
teammate in an Agent Team instead sends requests through the leader's content
generator, so the teammate effectively inherits the leader's route.

This has been observed with several custom model aliases. The issue is not
that the model frontmatter is rejected: the teammate can carry the requested
model ID in its runtime configuration while the request still uses the
leader's provider and content generator.

## What did you expect to happen?

A named teammate created from a custom agent definition should use the same
resolved model and provider route as an ordinary launch of that definition.
Agent Team membership should change coordination behavior, not model-routing
semantics.

## Reproduction

Use sanitized model and provider names in the public report.

1. Configure two distinguishable model routes in `settings.json`:
   - leader route `provider-a:leader-model`
   - teammate route `provider-b:worker-model`
2. Create `.qwen/agents/worker.md`:

   ```markdown
   ---
   name: worker
   description: Verify per-agent model routing
   model: provider-b:worker-model
   ---

   Report the provider and model route used for this request.
   ```

3. Restart Qwen Code so the model-provider settings are reloaded.
4. Launch `worker` through the ordinary Agent tool and verify that the request
   reaches `provider-b:worker-model`.
5. Create an Agent Team and spawn a named teammate with
   `agent_type: "worker"`.
6. Send the teammate a task and inspect provider logs or a local test endpoint.

### Actual result

The ordinary subagent reaches `provider-b:worker-model`. The named teammate
uses the leader's provider/content generator even though its runtime model
configuration identifies `worker-model`.

### Expected result

Both launch paths reach `provider-b:worker-model`.

## Client information

<details>
<summary>Client Information</summary>

```console
$ qwen /about
# Add output from the reproducing build before filing.
```

</details>

Platform: Add before filing.

## Login information

API Config with custom model providers. Do not include keys, tokens, or a
private base URL in the issue.

## Source analysis

The ordinary subagent path and Agent Team path diverge while resolving and
materializing the agent definition:

1. `SubagentManager.createSubagent()` calls
   `buildRuntimeContentGeneratorView()`.
2. That method resolves the model selector and creates a dedicated
   `RuntimeContentGeneratorView`.
3. `AgentHeadless.create()` receives that view, so the runtime publishes the
   selected content generator through `AsyncLocalStorage`.

Relevant code:

- `packages/core/src/subagents/subagent-manager.ts`
  - `createSubagent()`
  - `buildRuntimeContentGeneratorView()`
- `packages/core/src/models/content-generator-config.ts`
  - `createRuntimeContentGeneratorView()`

The Agent Team path drops two parts of that route:

1. `TeamManager.spawnTeammate()` calls `convertToRuntimeConfig()` without the
   active `Config`. A bare model selector therefore cannot recover its
   configured auth type, and `fast` or `inherit` cannot use the active model
   context.
2. The converted runtime configuration carries only the model ID. It does not
   carry the resolved auth type or a `RuntimeContentGeneratorView`.
3. `InProcessBackend.createPerAgentConfig()` creates a runtime content
   generator view only when `authOverrides?.authType` is present.
4. `TeamManager` does not pass `authOverrides` for a named agent definition.
5. Without a runtime view, `GeminiChat` resolves
   `config.getContentGenerator()` to the parent generator.

Relevant code:

- `packages/core/src/agents/team/TeamManager.ts`
  - `spawnTeammate()`
- `packages/core/src/agents/backends/InProcessBackend.ts`
  - `createPerAgentConfig()`
- `packages/core/src/agents/runtime/agent-core.ts`
  - `runReasoningLoop()`
- `packages/core/src/core/geminiChat.ts`
  - `makeApiCallAndProcessStream()`

This is a root-cause hypothesis until a focused test captures the selected
generator. It explains both observed forms of the bug: a bare configured model
can lose its provider identity, and an explicit selector can retain the model
ID while the actual request still uses the inherited generator.

## Why this is distinct from existing reports

[#9063](https://github.com/QwenLM/qwen-code/issues/9063) was classified as a
configuration question. Its triage response explicitly documents custom
agent model frontmatter and model-provider routing as supported behavior for
ordinary subagents. This report uses that supported configuration and shows a
specific divergence when the same agent definition becomes a named teammate.

No open or closed issue with this Agent Team-specific model-routing behavior
was found in searches for `agent team custom model`, `teammate model`, or
`agent definition model` on 2026-08-25.

## Proposed regression test

Add a test that provides:

- parent content generator A;
- a custom agent definition resolving to auth type and generator B;
- an Agent Team named-teammate launch using that definition.

Assert that:

1. the teammate receives a non-empty `RuntimeContentGeneratorView`;
2. the view's model and auth type match B;
3. the first generated request is made through generator B;
4. the parent continues using generator A after the teammate turn;
5. bare, explicit `authType:model-id`, `fast`, and `inherit` selectors match
   ordinary subagent semantics;
6. an explicit team-level model override follows the same resolution rules.

The test should live beside the backend and TeamManager coverage, with a
cross-path assertion that the ordinary and named-teammate launches resolve the
same effective route.

## Acceptance criteria

- Given a custom agent definition whose model resolves to a configured route
  different from the leader's route, when it is spawned as a named teammate,
  then its requests use the resolved content generator and auth type.
- Given an `inherit` selector, when the teammate is spawned, then it continues
  using the leader's route without creating an unnecessary generator.
- Given an unresolved selector, when the teammate is spawned, then behavior
  matches the ordinary subagent path and does not silently claim a different
  effective model.
- Given a teammate run completes or fails, then the leader's content generator
  and active model route remain unchanged.

## Before filing

- [ ] Replace aliases with sanitized reproducer names.
- [ ] Add `/about` output and exact commit.
- [ ] Capture one provider-side or local fake-server routing trace.
- [ ] Reproduce with an explicit `authType:model-id` selector.
- [ ] Add or link a minimal failing test branch if available.
- [ ] Re-run duplicate search.
