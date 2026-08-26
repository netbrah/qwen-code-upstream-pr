# Agent Team upstream issue review packet

> Status: Internal drafts only. No issue in this directory has been filed.
>
> Last reviewed: 2026-08-26
>
> Inspected source baseline: `a6d30ebc6`
>
> Design context: [`../2026-08-25-agent-team-durable-runtime.md`](../2026-08-25-agent-team-durable-runtime.md)

This directory preserves candidate reports without presenting static source
analysis as runtime proof. Each draft must pass its stated evidence and
duplicate-search gates before its English and Chinese public sections are
copied into GitHub.

## Filing standard

Bug reports must follow Qwen Code's current bug form in this order:

1. `What happened?`
2. `What did you expect to happen?`
3. `Client information`, including complete `/about` output and platform
4. `Login information`
5. `Anything else we need to know?`

Feature requests must use:

1. `What would you like to be added?`
2. `Why is this needed?`
3. `Additional context`

Every filed report should also include a minimal reproduction, exact
version/commit, provider/model/transport when relevant, a control case when
available, and a final open-and-closed duplicate search. The Chinese section
must describe the same observation and scope as the English section.

Source inspection is labeled separately:

- **Observed** means captured in a real session.
- **Reproduced** means repeated with a documented command or test.
- **Source-supported hypothesis** means the code contains a plausible path,
  but the proposed runtime behavior has not been demonstrated.
- **Source-established behavior** is reserved for behavior directly exercised
  by an existing or newly executed test.

## Draft inventory

| Order | Draft | Evidence level | Upstream disposition |
| --- | --- | --- | --- |
| 1 | [Named teammates ignore custom model routes](01-named-teammates-ignore-custom-model-routes.md) | User-observed; causal path remains a hypothesis | Hold for `/about`, sanitized config, and routing trace |
| 2 | [Broadcast can report success after a rejected delivery](02-broadcast-reports-success-after-partial-failure.md) | Static source inspection | Hold for invocation-level fault-injection test |
| 3 | [Teammate model metadata can diverge](03-teammate-metadata-reports-wrong-effective-model.md) | Static source inspection | Do not file separately unless routing is fixed and visible metadata still diverges |
| 4 | [`team_delete` can hide cleanup failure](04-team-delete-hides-cleanup-failure.md) | Static source inspection | Hold for injected filesystem failure |
| 5 | [Concurrent leader assignments may double-dispatch](05-concurrent-leader-assignments-double-dispatch.md) | Source-supported interleaving | Hold for barrier-controlled failing test |
| 6 | [Stale reclaim may delete a later team generation](06-stale-reclaim-deletes-new-generation.md) | Source-supported interleaving | Hold for two-creator integration test |
| 7 | [A fast initial result may precede bridge attachment](07-initial-teammate-result-lost-before-event-bridge.md) | Source-supported ordering risk | Hold for pre-bridge event test |
| 8 | [Concurrent failed spawn may persist a ghost member](08-concurrent-spawn-persists-ghost-member.md) | Source-supported interleaving | Hold for controlled backend/write barriers |
| 9 | [`send_message` destination validation](09-send-message-destination-ambiguity.md) | One user-observed diagnostic; both-field behavior is source-inspected | Split before filing; first capture the exact tool call |
| 10 | [Teammate-addressable roster](10-teammate-addressable-roster.md) | Product gap is not yet established | Reframe only after verifying the documented persisted team configuration is insufficient |
| 11 | [Queued Agent View message disappears after tab switch](11-agent-view-queued-message-lost-on-tab-switch.md) | User-observed; lifecycle path identified in source | Candidate after `/about`, exact steps, and screenshot or recording |
| 12 | [Backend-neutral Agent Team sessions](12-backend-neutral-team-sessions.md) | Internal architecture proposal | Keep internal; do not file as a packet issue |
| 13 | [ACP-backed delegated agent sessions](13-acp-delegated-agent-sessions.md) | Feature request based on existing ACP bridge capabilities | Ready after the design URL is published; file separately and link #10078 and #8775 |

## Sequencing

File at most one report at a time. Prefer a directly observed, narrowly
reproducible defect. Wait for triage before filing an adjacent report so a
maintainer can choose whether the behavior belongs in the same fix.

Do not use the broad architecture proposal to motivate a narrow bug report.
Do not mention Prime Agent in bug reports. Do not prescribe a redesign when a
smaller invariant can be stated and tested.

## Existing issues to preserve as separate scope

- [#8172](https://github.com/QwenLM/qwen-code/issues/8172) tracks teammate
  messages delayed behind a long running turn. Draft 11 instead concerns an
  already submitted message stored only in component state and lost when the
  user changes Agent View tabs.
- [#9449](https://github.com/QwenLM/qwen-code/issues/9449) tracks
  leader-visible team health and terminal failures.
- [#9063](https://github.com/QwenLM/qwen-code/issues/9063) documents model
  selection for ordinary custom agents; draft 1 tests a possible Agent Team
  divergence.
- [#7984](https://github.com/QwenLM/qwen-code/issues/7984) explains why a
  top-level JSON Schema `oneOf` should not be proposed for draft 9.

## Final pre-filing checklist

- [ ] Reproduce against current `main`.
- [ ] Paste complete `/about` output and platform.
- [ ] Record install channel, Node version, auth mode, provider/model, and
      relevant sanitized configuration.
- [ ] Include the exact command, tool call, or UI sequence and exact result.
- [ ] Include a control case when one exists.
- [ ] Mark static analysis as a possible cause unless a test proves it.
- [ ] Remove implementation mandates from the public report.
- [ ] Search open and closed issues again and save the queries and candidates.
- [ ] Verify the Chinese section matches the final English body.
- [ ] File only after explicit review and approval.
