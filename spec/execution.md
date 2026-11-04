# Execution Semantics

**Status:** Draft normative behavioral contract. **Part:** execution. **Requires:** definition, invocation for action-bearing hosts. This document defines the small sequential core. The [`parallel`](parallel.md) profile extends it with several positions.

## 1. Operational model

In `core`, a run has exactly one active position or a terminal result. With the `parallel` profile it has one position per open branch; the rules below apply to each position. Nodes are entered one at a time, cycles are permitted, and each visit is a distinct **activation**. The pure transition engine receives a validated pinned definition, prior state and accepted event, and produces a new state and authorized commands. The transition function MUST NOT perform I/O, read a clock or choose an implementation binding.

~~~text
transition(definition, previousState?, acceptedEvent)
  -> { nextState, commands, diagnostics }
~~~

The authority that commits a transition is responsible for ensuring that a command is durably authorized **before** it is dispatched. An emitted command is an intent, not proof the effect completed. A standalone non-durable interpreter MAY be simpler but cannot claim the Durability part.

## 2. Entering nodes

- `activity`: compute its input mapping and schedule one invocation of the bound action. Status becomes `running` until a result or intervention.
- `await-signal`: enter `waiting`. A signal with the expected name and an allowed outcome selects a route.
- `complete`: evaluate its output and end `completed`.
- `fail`: end `failed` with the declared error.

A run begins at `start`. Upon taking a route, the source node's latest `{visit,outcome,output}` is recorded. The target counts a new visit and may schedule more work immediately. An implementation MUST bound internal transitions even where no external activity yields.

Several routes may lead to one node: a **merge**. In `core`, at most one of them is ever taken per visit, because a run has one active position. Entering the node through any of them is one visit, and `from` names the route that was taken: the source node, its outcome and its output. Routes taken at the same time are a gather, which only the `parallel` profile defines.

## 3. Outcome routing and loops

A successful action's declared business outcome selects exactly its route. Operational failure selects a `failed` route if one exists; absent one, the run becomes terminal `failed`. Business negative outcomes (such as `rejected`) are not automatically operational failures.

An outcome-limited route with limit N is followed for the first N **consecutive results from that node**; the next occurrence selects the required `exhausted` route. Other outcomes reset the streak. Retry of one invocation does **not** count as a new node visit. Looping through graph edges does.

Taking the `exhausted` route changes only the route. The node's record and `from` at the target hold the outcome the node produced, so `from.outcome` is never `exhausted`.

Workflow-wide visit and activation limits are terminal safety boundaries. They MUST NOT be silently converted into an authored business branch.

## 4. Attempts, unknown outcomes and effects

An invocation has a stable logical ID and a separate delivery-attempt number. `retry.maxAttempts` counts the first attempt. A retryable failure may authorize the next attempt until its cap is reached; terminal operational failure follows `failed` or fails the run.

When an invocation's result is **unknown** (worker crash, lease loss, lost acknowledgement), an `unsafe` effect MUST stop for intervention rather than repeat automatically. A host may repeat a `pure`, `read-only` or `idempotent` action within its attempt cap, using the **same** logical invocation and idempotency key. Exhaustion of attempts with still-unknown outcome must not pretend the external effect failed; it requires an explicit resolution mechanism.

The standard cannot guarantee exactly-once external effects. Implementations are responsible for making stated idempotency obligations true at the integration boundary.

## 5. Signals, cancellation and sequencing

The core signal profile accepts a matching signal while a position is waiting at an `await-signal` node with that signal name and a route for the signal's outcome. A reserved outcome name (`failed`, `exhausted`, `unmet`) never matches. Events that arrive when no matching waiter exists are reported unmatched (`signal.unmatched`); an optional buffered-signal profile may define durable early delivery, order and capacity.

Cancellation is a durable control request with an observable run status, not proof that every already-authorized external effect was interrupted or reversed. A `cancel` event sends a cancel command to every open invocation and ends the run as `cancelled`. In-flight cancellation acknowledgements, compensation and hard stop behavior require additional declared profiles.

**Stopping.** An `unsafe` invocation outlives the decision to stop. When a run is about to end as `failed` or `cancelled` while an `unsafe` invocation is running, or is parked on an unknown result, the run instead enters the status `stopping` and keeps the pending end (`failed` with its error, or `cancelled`):

1. Everything else stops as it would have. The `unsafe` invocation gets the cancel command too, since a request to stop is not a known result (invocation §5), but the run waits for its result.
2. A known result, success or failure, is recorded in `nodes.<id>` (`{visit, outcome, output}`, or `{visit, outcome: "failed", output: {error}}`) and the run ends with the pending end. No further attempt is made, even when the failure is retryable, and the outcome routes nowhere.
3. An `unknown` result shows the run as `needs-intervention`, as §4 requires. A `resolve` as `complete` or `fail` records the result and the run ends with the pending end. A `resolve` as `retry` invokes the action again and the run stays `stopping`. A run never ends while an `unsafe` result is unknown.
4. A `cancel` event during `stopping` is reported as `run.cancel-ignored` and changes nothing; the pending end stays what it was.
5. A deadline on the invocation (invocation §5) bounds how long a run can stay `stopping`.

Accepted events for a given run MUST have a well-defined order. Duplicate or stale results MUST NOT advance the run twice. Runtime adapters MAY use different private histories but MUST preserve the same observable routing, work authorization and results for claimed profiles.

## 6. State-machine acceptance examples

- `start` at `activity`: exactly one logical invocation is authorized.
- `result(ok)`: records result and enters the routed target.
- `signal(approved)` at matching waiter: routes once; duplicate delivery does not.
- `result(unknown)` from unsafe invocation: parks for an explicit human/system resolution.
- A limited result routes via `exhausted` only after the allowed streak.
- Re-entering a node after a business loop creates a new invocation; retrying its same invocation does not.
- `cancel` while an `unsafe` invocation runs: the cancel command is sent, the run is `stopping`, and it ends `cancelled` once the result is known and recorded.

See [Conformance](conformance.md) for what can currently be tested. Parallel branches are specified in the [`parallel`](parallel.md) profile. Subworkflow calls, timers and compensation require separately specified semantics and tests.
