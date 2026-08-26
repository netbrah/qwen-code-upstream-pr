# Qwen Code upstream filing notes

> Review date: 2026-08-25
>
> Packet status: Internal review only

This file records the standards used to review the Agent Team issue packet.
It is not an issue body.

## Repository requirements reviewed

- `.github/ISSUE_TEMPLATE/bug_report.yml`
- `.github/ISSUE_TEMPLATE/feature_request.yml`
- `CONTRIBUTING.md`

The local copies were checked against current `QwenLM/qwen-code`. Bug reports
require `What happened?`, `What did you expect to happen?`, and complete
client information from `/about`, including platform. The form also provides
fields for login information and additional context.

Feature requests use `What would you like to be added?`, `Why is this
needed?`, and `Additional context`.

`CONTRIBUTING.md` asks contributors to search existing issues and discuss an
issue before starting a PR. PR requirements such as `npm run preflight`,
documentation, and visual evidence apply after maintainers agree on a change;
they should not be presented as proof that a draft bug exists.

## Prior reports reviewed

The following reports by `netbrah` were used as style references:

- [#9290](https://github.com/QwenLM/qwen-code/issues/9290): clearly separates
  observation from unknown trigger and root cause. It states what was not
  reproduced and does not convert related symptoms into a causal claim.
- [#9507](https://github.com/QwenLM/qwen-code/issues/9507): provides a short,
  deterministic UI sequence, a control against the main view, exact
  environment details, and a Chinese translation.
- [#9509](https://github.com/QwenLM/qwen-code/issues/9509): ties a narrow
  scheduler invariant to precise source sites. Maintainer feedback explicitly
  valued the line references and contrast.
- [#9283](https://github.com/QwenLM/qwen-code/issues/9283): includes a failing
  test branch, exact command, control assertions, and a statement of what the
  report does not claim.
- [#9510](https://github.com/QwenLM/qwen-code/issues/9510): uses field evidence
  and avoids mandating one implementation, but also demonstrates the
  reputation cost of filing near already active work without a final
  duplicate check.
- [#7984](https://github.com/QwenLM/qwen-code/issues/7984): uses a live API
  reproducer and a direct control. Its narrow fix suggestion was justified by
  a fully demonstrated mechanism; that standard does not apply to the
  source-only race drafts in this packet.

The packet follows the newer bilingual pattern by placing Chinese text in a
collapsed `<details><summary>中文</summary>` section or, for held research
notes, an explicitly labeled Chinese review section.

## Evidence rules applied

1. Static code inspection is not runtime reproduction.
2. A plausible interleaving is not called deterministic until an executed
   barrier test forces it.
3. A user-observed symptom does not establish the causal source path.
4. Missing traces and environment details are stated explicitly.
5. Public text describes the invariant and leaves implementation choice to
   maintainers.
6. Related issues are described as related or distinct only on demonstrated
   scope; the packet does not claim exhaustive absence of duplicates.
7. Prime Agent and the broad redesign are excluded from narrow bug reports.

## Duplicate-search record

Open and closed searches run on 2026-08-25 included:

- `Agent Team custom model teammate`
- `Agent Team broadcast delivery failure`
- `Agent Team queued message tab switch`
- `Agent Team ghost member spawn`
- `Agent Team stale reclaim`
- `send_message task_id teammate`
- `agent team custom model`
- `teammate model`
- `agent definition model`
- `AgentComposer queue`
- `queued message tab switch`
- `agent view message lost`
- `send_message teammate task_id`
- `No background task found`
- `Teammate not found`
- `agent team roster`
- `teammate discovery`

The search returned
[#9276](https://github.com/QwenLM/qwen-code/issues/9276) for the messaging
terms. It covers team members being unable to send ordinary messages to their
leader, not the destination-field ambiguity in draft 9. No query result is
treated as proof that no duplicate exists; all searches must be rerun
immediately before filing.

## Current disposition

### Candidates after session evidence

- **Draft 1:** needs complete environment details, sanitized configuration,
  an ordinary-subagent control, and a provider-side or fake-server routing
  trace.
- **Draft 9:** needs the original sanitized tool call to determine whether it
  contained only `task_id` or both destination fields. The two-field
  validation defect and teammate-aware diagnostic may become separate issues.
- **Draft 11:** needs current-main reproduction, `/about`, a no-tab-switch
  control, and a short screenshot sequence or recording.

### Hold for executable proof

- **Drafts 2 and 4:** require invocation-level fault injection.
- **Drafts 5 through 8:** require controlled barriers that force the proposed
  ordering and assert externally visible state or delivery.

### Do not file in current form

- **Draft 3:** keep as a routing acceptance condition unless a visible
  metadata defect remains after routing is fixed.
- **Draft 10:** first verify whether the documented persisted team
  configuration already supplies the intended roster.
- **Draft 12:** keep as internal architecture context. It is too broad for the
  narrow issue sequence and should not mention Prime Agent unless maintainers
  explicitly invite a separate design discussion.

## Filing sequence

1. Finish one candidate's evidence package.
2. Rerun open and closed duplicate searches.
3. Compare English and Chinese sections line by line for equivalent claims.
4. Review the exact GitHub body without internal notes.
5. File only after explicit approval.
6. Wait for maintainer or triage-bot classification before preparing an
   adjacent report.
