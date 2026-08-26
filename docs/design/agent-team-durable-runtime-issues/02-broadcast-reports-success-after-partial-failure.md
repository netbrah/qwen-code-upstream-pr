# Draft: Agent Team broadcast reports success after partial failure

> Filing status: Not filed
>
> Classification: Bug
>
> Evidence: Confirmed by source; deterministic test still required

## Suggested title

Agent Team: broadcast reports success when delivery to one or more teammates fails

## What happened?

`send_message(to: "*")` can report `Message broadcast to all teammates.` even
when delivery to one or more recipients failed.

`TeamManager.broadcast()` waits with `Promise.allSettled()`, logs rejected
deliveries, and then resolves normally. The `send_message` tool therefore
cannot distinguish complete success from partial or total failure.

## What did you expect to happen?

The tool result should report which recipients accepted the message and which
failed. A total failure should return an error. A partial failure should
return a structured partial-success result that the leader can act on.

## Reproduction

1. Create a team with at least two teammates.
2. Make one teammate address fail deterministically after the recipient list
   is built, for example with a backend test double that rejects delivery for
   one agent ID.
3. Call `send_message(to: "*", message: "checkpoint")`.

Actual: the tool returns `Message broadcast to all teammates.`

Expected: the tool identifies successful and failed recipients and does not
claim complete delivery.

## Source analysis

- `packages/core/src/agents/team/TeamManager.ts`
  - `broadcast()` uses `Promise.allSettled()`.
  - rejected results are logged but not returned or thrown.
- `packages/core/src/tools/send-message.ts`
  - the broadcast branch returns a fixed success message after the promise
    resolves.

## Proposed regression test

Inject three recipients into `broadcast()`:

- one successful delivery;
- one rejected delivery;
- one unavailable member.

Assert the returned result preserves all recipient outcomes and that
`send_message` does not render complete success.

## Acceptance criteria

- A complete broadcast returns all successful recipient IDs.
- A partial broadcast returns both successful and failed recipient IDs.
- A total broadcast failure returns a tool error.
- Logging is supplemental; callers do not need logs to discover failure.

## Before filing

- [ ] Add exact current-main line references.
- [ ] Add a deterministic unit reproduction.
- [ ] Decide whether the smallest fix returns a result object or throws an
      aggregate error.
- [ ] Re-run duplicate search.
