# Execution Semantics

**Status:** Draft normative behavioral contract. **Part:** execution. **Requires:** definition, invocation for action-bearing hosts. This document defines the small sequential core, not parallel execution.

## 1. Operational model

A run has exactly one active position or a terminal result. Nodes are entered one at a time, cycles are permitted, and each visit is a distinct **activation**. The pure transition engine receives a validated pinned definition, prior state and accepted event, and produces a new state and authorized commands. The transition function MUST NOT perform I/O, read a clock or choose an implementation binding.

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

## 3. Outcome routing and loops

A successful action's declared business outcome selects exactly its route. Operational failure selects a `failed` route if one exists; absent one, the run becomes terminal `failed`. Business negative outcomes (such as `rejected`) are not automatically operational failures.

An outcome-limited route with limit N is followed for the first N **consecutive results from that node**; the next occurrence selects the required `exhausted` route. Other outcomes reset the streak. Retry of one invocation does **not** count as a new node visit. Looping through graph edges does.

Workflow-wide visit and activation limits are terminal safety boundaries. They MUST NOT be silently converted into an authored business branch.

## 4. Attempts, unknown outcomes and effects

An invocation has a stable logical ID and a separate delivery-attempt number. `retry.maxAttempts` counts the first attempt. A retryable failure may authorize the next attempt until its cap is reached; terminal operational failure follows `failed` or fails the run.

When an invocation's result is **unknown** (worker crash, lease loss, lost acknowledgement), an `unsafe` effect MUST stop for intervention rather than repeat automatically. A host may repeat a `pure`, `read-only` or `idempotent` action within its attempt cap, using the **same** logical invocation and idempotency key. Exhaustion of attempts with still-unknown outcome must not pretend the external effect failed; it requires an explicit resolution mechanism.

The standard cannot guarantee exactly-once external effects. Implementations are responsible for making stated idempotency obligations true at the integration boundary.

## 5. Signals, cancellation and sequencing

The core signal profile accepts a matching signal while a workflow is waiting at the intended node. Events that arrive when no matching waiter exists are reported unmatched; an optional buffered-signal profile may define durable early delivery, order and capacity.

Cancellation is a durable control request with an observable run status, not proof that every already-authorized external effect was interrupted or reversed. In-flight cancellation acknowledgements, compensation and hard stop behavior require additional declared profiles.

Accepted events for a given run MUST have a well-defined order. Duplicate or stale results MUST NOT advance the run twice. Runtime adapters MAY use different private histories but MUST preserve the same observable routing, work authorization and results for claimed profiles.

## 6. State-machine acceptance examples

- `start` at `activity`: exactly one logical invocation is authorized.
- `result(ok)`: records result and enters the routed target.
- `signal(approved)` at matching waiter: routes once; duplicate delivery does not.
- `result(unknown)` from unsafe invocation: parks for an explicit human/system resolution.
- A limited result routes via `exhausted` only after the allowed streak.
- Re-entering a node after a business loop creates a new invocation; retrying its same invocation does not.

See [Conformance](conformance.md) for what can currently be tested. Features beyond this core, notably parallel forks, joins, subworkflow calls, timers and compensation, require separately specified semantics and tests.
