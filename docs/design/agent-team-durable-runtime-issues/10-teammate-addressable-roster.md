# Draft: expose an addressable Agent Team roster to teammates

> Filing status: Not filed
>
> Classification: Feature request
>
> Evidence: Source-confirmed model-visible discovery gap
>
> Filing gate: Decide whether to file separately or extend #9449

## Suggested title

Agent Team: expose canonical peer names so teammates can discover and message
one another

## What would you like to be added?

Expose a read-only, model-visible Agent Team roster to teammates. The roster
must provide the canonical name accepted by
`send_message(to: "<teammate-name>")` for each currently addressable member.

A minimal projection could be:

```json
{
  "team": "release-review",
  "members": [
    {
      "name": "source-reviewer",
      "status": "RUNNING",
      "addressable": true
    },
    {
      "name": "qa-reviewer",
      "status": "IDLE",
      "addressable": true
    }
  ]
}
```

This can be implemented as a teammate-accessible `team_status` or
`team_members` tool. If the accepted health-status work in #9449 introduces a
shared status projection, the same projection can be reused, provided it is
available from teammate contexts and clearly marks canonical messaging names.

## Why is this needed?

Peer-to-peer delivery already exists. `TeamManager.sendMessage()` can route a
message from one teammate to another by canonical member name, and
`send_message` documents `to` as the team destination field.

However, the teammate system prompt provides only:

- the teammate's own name;
- the team name;
- the leader's name;
- instructions and examples centered on `task_list` and
  `send_message(to: "leader")`.

It does not enumerate peers or provide a roster-discovery operation.

The available tools do not close the gap:

- `task_list` lists work items, not members. It reveals a teammate name only
  when a task happens to have that owner.
- unassigned, idle, read-only, and newly joined teammates may not appear as
  task owners;
- completed tasks are not a reliable statement of current addressability;
- `list_agents` intentionally lists only ordinary background subagents and
  explicitly excludes named Agent Team teammates.

As a result, a teammate can use peer messaging only if another prompt or task
happens to disclose the exact peer name. The transport supports peer
communication, but its address book is not model-visible.

## Example

1. Create an Agent Team.
2. Spawn `source-reviewer` and `qa-reviewer`.
3. Give `source-reviewer` an unassigned investigation task.
4. Give `qa-reviewer` a separate task, or leave it idle.
5. Ask `source-reviewer` to request verification from the QA teammate.

### Actual result

`source-reviewer` knows its own name and the leader's name. It has no
authoritative way to discover that the peer's canonical address is
`qa-reviewer`. Depending on the model, it may:

- send only to `leader`;
- guess a display name;
- inspect task owners and infer a possibly incomplete roster;
- place the guessed peer name in `task_id` and receive `Task not found`.

### Expected result

The teammate can call a read-only roster/status operation, obtain
`qa-reviewer` as an addressable canonical name, and then call:

```json
{
  "to": "qa-reviewer",
  "message": "Please verify the failing test in task #3."
}
```

## Scope and privacy

The roster should expose only coordination metadata needed for safe
addressing:

- team name;
- canonical teammate name;
- lifecycle status;
- whether the teammate is currently addressable;
- optionally assigned task IDs or subjects if those are already visible
  through `task_list`.

It should not expose:

- prompts or agent-definition bodies;
- message contents or raw model output;
- model credentials or provider secrets;
- session IDs;
- private absolute paths;
- hidden reasoning;
- unrelated ordinary background agents.

The operation must be observational only. Reading the roster must not wake,
restart, stop, assign, or otherwise mutate a teammate.

## Source analysis

`buildTeammatePromptAddendum()` receives only `teammateName`, `teamName`, and
`leaderName`. Every messaging example targets `leader`; peer names are not
included.

`TaskListInvocation.execute()` renders task ID, status, optional owner, and
subject. It does not read the team membership file and cannot represent
unassigned or otherwise task-invisible peers.

`ListAgentsInvocation.execute()` reads `BackgroundTaskRegistry`, not
`TeamManager`. Following #9431, its description and empty state correctly
state that named Agent Team teammates are not listed.

`TeamManager` already owns the needed canonical membership and lifecycle
state. It also has an internal team-status summary, so the missing piece is a
privacy-safe model projection rather than a new source of truth.

Relevant code:

- `packages/core/src/agents/team/promptAddendum.ts`
  - `buildTeammatePromptAddendum()`
- `packages/core/src/tools/task-list.ts`
  - `TaskListInvocation.execute()`
- `packages/core/src/tools/list-agents.ts`
  - `ListAgentsInvocation.execute()`
- `packages/core/src/agents/team/TeamManager.ts`
  - membership state
  - `sendMessage()`
  - team status summary
- `packages/core/src/agents/team/teamHelpers.ts`
  - `findMemberByName()`
  - `sanitizeName()`

## Relationship to existing issues

[#9431](https://github.com/QwenLM/qwen-code/issues/9431) correctly clarified
that `list_agents` and Agent Teams are separate control planes. This proposal
preserves that boundary and adds discovery to the Agent Team surface rather
than merging registries.

[#9449](https://github.com/QwenLM/qwen-code/issues/9449) requests
leader-visible team health and automatic terminal failure notifications. Its
accepted scope is primarily leader observability. This draft concerns
teammate-visible peer discovery and canonical addressing. The implementation
may share a projection, but the user stories and access contexts differ.

No open or closed issue matching `agent team roster`, `teammate discovery`,
or peer-name discovery was found on 2026-08-25.

## Proposed regression tests

Add tests that create a leader and multiple named teammates, then invoke the
roster/status operation from a teammate context:

1. the caller sees its own canonical name, the leader, and all current peers;
2. each returned peer name is accepted unchanged by
   `send_message(to: name)`;
3. a human-form name normalized during spawn is returned in canonical form;
4. unassigned and idle teammates remain discoverable;
5. a terminated or removed teammate is either omitted or explicitly marked
   `addressable: false`;
6. ordinary background agents do not appear;
7. no prompts, message bodies, raw output, credentials, session IDs, or
   absolute paths appear;
8. reading the roster produces no lifecycle, task-assignment, or wake event.

Add a prompt-contract test that teaches teammates to use the roster before
peer messaging and includes one explicit
`send_message(to: "<peer-name>")` example.

## Acceptance criteria

- Every active teammate can discover the canonical names of peers it is
  permitted to message.
- Every member marked `addressable: true` accepts a direct
  `send_message(to: name)` call.
- Discovery does not depend on task ownership.
- The roster distinguishes the leader, the calling teammate, peer teammates,
  and ordinary background agents.
- The roster is read-only and privacy-safe.
- Dynamic membership changes are reflected without relying on a static prompt
  snapshot.
- The implementation preserves `TeamManager` as the authoritative membership
  and routing source.

## Before filing

- [ ] Decide whether maintainers prefer a separate issue or an extension of
  #9449.
- [ ] Capture one sanitized session where a teammate cannot determine a peer's
  canonical name.
- [ ] Capture the associated misrouted `send_message` call if present.
- [ ] Add `/about` output, platform, and exact commit.
- [ ] Confirm the proposed tool name against any implementation emerging from
  #9449.
- [ ] Re-run duplicate search.
