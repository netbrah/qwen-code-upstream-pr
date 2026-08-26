# Agent Team issue drafts

> Status: Draft only. Do not file without an explicit review and approval.
>
> Last hardened: 2026-08-25
>
> Design: [`../2026-08-25-agent-team-durable-runtime.md`](../2026-08-25-agent-team-durable-runtime.md)

This directory separates concrete defects from the broader Agent Team runtime
proposal. The goal is to give Qwen maintainers small, reproducible issues that
can be fixed on current `main`, while keeping the larger architectural
direction transparent.

## Draft inventory

| Order | Draft | Classification | Current confidence | Filing gate |
| --- | --- | --- | --- | --- |
| 1 | [Named teammates ignore custom model routes](01-named-teammates-ignore-custom-model-routes.md) | Bug | User-observed; source path strongly supports the cause | Capture `/about`, sanitized config, and one routing trace |
| 2 | [Broadcast reports success after partial delivery failure](02-broadcast-reports-success-after-partial-failure.md) | Bug | Confirmed by source | Add deterministic unit reproduction |
| 3 | [Teammate metadata can report the wrong effective model](03-teammate-metadata-reports-wrong-effective-model.md) | Bug | Confirmed by source | Add focused assertion against joined/list output |
| 4 | [`team_delete` can report success after cleanup failure](04-team-delete-hides-cleanup-failure.md) | Bug | Deterministic filesystem error path | Reproduce with an injected filesystem failure |
| 5 | [Concurrent leader assignments can dispatch one task twice](05-concurrent-leader-assignments-double-dispatch.md) | Bug | Deterministic source interleaving | Add barrier-controlled regression test |
| 6 | [Stale reclaim can delete a newly created live team](06-stale-reclaim-deletes-new-generation.md) | Bug | Deterministic cross-session race | Add generation-controlled integration test |
| 7 | [Initial teammate result can be lost during spawn](07-initial-teammate-result-lost-before-event-bridge.md) | Bug | Deterministic source ordering | Add pre-bridge event replay test |
| 8 | [Concurrent failed spawn can persist a ghost member](08-concurrent-spawn-persists-ghost-member.md) | Bug | Deterministic source interleaving | Add controlled backend/write barriers |
| 9 | [`send_message` misroutes ambiguous teammate destinations](09-send-message-destination-ambiguity.md) | Bug | User-observed symptom; deterministic source routing | Capture one sanitized failing tool call and add focused invocation tests |
| 10 | [Expose an addressable Agent Team roster to teammates](10-teammate-addressable-roster.md) | Feature request | Source-confirmed discovery gap | Validate desired relationship to #9449 before filing |
| 11 | [Backend-neutral Agent Team sessions and supervised workers](11-backend-neutral-team-sessions.md) | Feature request / RFC | Design complete; scope needs maintainer calibration | File only after one or two accepted vertical bug fixes |

The queued-message delay is not drafted as a new issue because
[#8172](https://github.com/QwenLM/qwen-code/issues/8172) already tracks it.
Leader-visible terminal health is already covered by
[#9449](https://github.com/QwenLM/qwen-code/issues/9449). The umbrella draft
should link those issues rather than compete with them.

The teammate-roster draft is related to #9449 but does not duplicate its
current leader-health scope. It asks for canonical peer addressing from a
teammate context. Before filing, decide whether maintainers prefer a separate
discovery issue or a narrowly scoped extension of #9449.

PID-only stale ownership is also not drafted as a bug. Current source comments
and tests deliberately treat ambiguous ownership conservatively, so PID reuse
is an architectural hardening opportunity rather than an undocumented
invariant violation.

## Hardening rounds

### Evidence round

- Reproduce against a named commit on current `main`.
- Record Qwen `/about` output and platform.
- Remove API keys, tokens, private base URLs, and proprietary model names.
- Capture the requested model selector, resolved model ID, auth type, route
  identity, and actual content-generator identity.
- Verify whether the failure reproduces with both a bare model ID and an
  explicit `authType:model-id` selector.

### De-duplication round

- Search open and closed issues again immediately before filing.
- Compare the model-routing issue with
  [#9063](https://github.com/QwenLM/qwen-code/issues/9063). That issue confirms
  custom-agent model selection is supported, but it does not report the Agent
  Team divergence.
- Link existing issues where behavior overlaps; do not broaden a bug report
  into an architecture debate.

### Maintainer-action round

- Keep the title user-visible and falsifiable.
- Put the shortest deterministic reproduction before source analysis.
- State implementation analysis as a hypothesis unless a regression test
  proves the exact cause.
- Include a proposed regression test and acceptance criteria.
- Avoid mentioning Prime Agent in narrow bug reports. Mention it only as
  optional prior art in the transparent architecture request.

### Filing round

- File one issue at a time.
- Start with either the custom-model routing bug or concurrent task
  double-dispatch. The first has direct user evidence; the second has the
  smallest deterministic concurrency invariant. The `send_message` routing
  bug is also a strong early candidate once a sanitized failing tool call is
  captured because its misleading `Task not found` result is user-visible and
  its branch precedence is deterministic.
- Give the Qwen triage bot and maintainers time to classify the first report
  before filing adjacent issues.
- Do not file the umbrella RFC until the concrete reports establish the
  repeated boundary failures it is intended to solve.
