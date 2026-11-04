# RFC 0001: the `parallel` profile

**Status:** Draft proposal. Nothing here is normative. **Issue:** [#6](https://github.com/Web-tree/spore-workflow-language/issues/6). **Against:** draft commit `eecc69e`.

This RFC follows step 2 of [GOVERNANCE.md](../GOVERNANCE.md): scope, normative behavior, compatibility, security, and positive and negative tests. Nothing has been implemented or run. Every name it introduces (`need`, `optional`, `losers`, `drop`, `unmet`, `arrivals`, `stopping`) is a working name, and the rules are expected to change once an implementation produces traces.

It depends on three core changes that are tracked separately: the merge rule ([#9](https://github.com/Web-tree/spore-workflow-language/issues/9)), the conformance fixture format ([#10](https://github.com/Web-tree/spore-workflow-language/issues/10)), and one core change proposed in §9 of this document, about what happens to a running `unsafe` invocation when a run stops. Checking an action's input and output formats was in the first draft of this RFC and is now its own issue ([#8](https://github.com/Web-tree/spore-workflow-language/issues/8)), because it changes `core`.

## 1. Summary

A definition that requires `parallel` can start several branches at once and have one node wait for them. There is no separate fork or join node. The node where the branches meet waits for all of them unless it says otherwise:

~~~dot
digraph "ci" {
  start = "build";
  build -> {lint test};
  {lint test} -> done;
  done [kind="complete"];
}
~~~

`build -> {lint test}` is a **split**: `lint` and `test` start together, and each then runs under the unchanged sequential rules. `done` is a **gather**: the node where the branches meet. It needs no attribute to wait for both. A gather that should start earlier says how many arrivals it needs:

~~~dot
  a -> {b c d};
  {b c d} -> e;
  e [need="any"];      // or a number
~~~

A gather can be a node of any kind, and it can read what each branch delivered.

## 2. Terms

- **Split:** one outcome routed to two or more nodes, which then start together. The node that holds the split route is written S below.
- **Branch:** one path running after a split. A branch has one active position and follows the core rules.
- **Gather:** the node where the branches of one split meet. §6 says how it is found.
- **Arrival:** what one branch delivered to its gather: the outcome and output of the route that reached it. An arrival is named after the branch's first node.
- **Drop:** a node kind that ends a branch with no arrival.
- **Loser:** a branch still running when its gather has decided.
- **Region(b):** the nodes of branch b, as §6 defines them. The gather, `fail` nodes and `drop` nodes are never in a region.

Do not confuse a gather with a **merge**. In a merge, several routes reach a node but only one is ever taken, because the paths are alternatives. Core merges are unchanged by this RFC; the core text that defines them is [#9](https://github.com/Web-tree/spore-workflow-language/issues/9).

## 3. Scope

**In scope:** nested splits and gathers; `need` of `all`, `any` or a number; optional arrivals; stopping or waiting for losers; failure while branches run.

**Out of scope, and rejected by validators until specified:**

- Running a node once per arrival. Copies would multiply through every later node, and the first to reach a `complete` node would end the run while others still work. Placing the work inside each branch covers most uses.
- A custom condition or a node deciding for itself. A condition needs the expression profile, which has no text yet. A node that decides on each arrival shares the problem above, and validation can't show that it ever decides.
- Graphs whose branches overlap without nesting (`a -> d; b -> d; b -> e`), dynamic fan-out over a list, compensation, and timers.
- A terminal gather that can miss its need (§6, P9). It would need an `unmet` route, and terminal nodes have no routes.
- A branch that can never reach its gather (§6, P2). With `need: "all"` it could only make the gather unmet, and with any other `need` it does nothing; the work belongs outside the split.

## 4. Definition model

A definition using any of this MUST declare `"requires": ["core", "parallel"]`. `parallel` does not stand alone.

**A split.** A route value may be an array of two or more node IDs, listed in ascending order with no duplicates:

~~~json
{ "build": { "kind": "activity", "action": "build",
             "routes": { "ok": ["lint", "test"] } } }
~~~

**A gather.** A node is a gather when it is the meeting point of a split, as §6 defines it. Any node kind can be a gather, and only a gather may carry these members. M below is always the length of the split's route array.

| Member | Values | Meaning |
| --- | --- | --- |
| `need` | `"all"` (default), `"any"`, or an integer from 1 to M | How many arrivals the node needs. `"any"` means 1 and `M` means `"all"` |
| `optional` | Array of arrival names | Arrivals that may be missing, because their branch ended at a `drop` node. Only with `need: "all"`. A missing optional arrival is recorded as `null` under its name |
| `losers` | `"stop"` (default) or `"wait"` | What happens to branches still running when the node decides |

**A branch end.** A new node kind, `drop`, has no members. A route to it ends the innermost branch and delivers nothing. A `drop` node is never entered: it counts no visit, has no `nodes` entry, and is not subject to `maxVisitsPerNode`. Several branches may share one `drop` node, and only region nodes may route to it.

**`unmet`.** A reserved outcome, like `exhausted`. A gather takes its `unmet` route, without being entered, when its need can no longer be met. The gather's record then becomes `{visit, outcome: "unmet", output: null, arrivals}` with `visit` unchanged, and at the target `from` is `{node: <gather>, outcome: "unmet", output: null}`, so the `unmet` handler can read who did arrive.

**Reading arrivals.** A mapping path may begin with `arrivals` on a gather: `{"$get": ["arrivals", "test", "output"]}`. Each arrival is `{outcome, output}`, or `null` for an optional branch that dropped, so a mapping can read it without a fallback operator. When the gather is entered, or takes `unmet`, its arrivals are also recorded as `nodes.<gather>.arrivals`, so later nodes can read them. For a gather of a kind that core never records (`complete`, `fail`), the record is `{visit, arrivals}`. At a gather, `from` is null, as it is at `start`.

## 5. SWL-DOT

| Location | Attribute | Meaning |
| --- | --- | --- |
| node | `need`, `losers` | As in §4 |
| node | `kind` | Also accepts `drop` |
| edge | `optional` | `true` on an arrow into the gather marks that branch's arrival as optional. It normalizes to the gather's `optional` list |

A split is written with a group: `a -> {b c}`. Per the [DOT language](https://graphviz.org/doc/info/lang.html), this is equivalent to `a -> b` and `a -> c`, and a parser normalizes it to one route with an array value. A group on the left, `{b c} -> d`, is two ordinary edges. A chain may contain a group, so `a -> {b c} -> d` is a split at `a` whose two branches both route to `d`, exactly as DOT expands it. A subgraph is accepted only as an unnamed, attribute-free group of node IDs in an edge statement. Named subgraphs, clusters, nested groups, statements inside a group, and ports stay rejected.

Two separate edges from one node with the same outcome, `a -> b; a -> c`, remain the existing duplicate-route error. A split has to be drawn as a group, so a forgotten `on="failed"` can't turn into a split by accident. The attributes above are authoritative in DOT, and `settings.json` MUST NOT override them.

## 6. Static rules

**Finding the gather.** For a split at node S with targets T1..TM:

1. R(t) is the set of nodes reachable from target t along routes that don't pass through S, leaving out `fail` and `drop` nodes.
2. C is the set of nodes that are in R(t) for two or more targets.
3. The gather G is the one node of C such that, with G removed from the graph, no node of C is reachable from any target along routes that don't pass through S. In words: every way from a branch into the shared part of the graph goes through G first.
4. Region(b) is the set of nodes reachable from target b along routes that pass through neither S nor G, leaving out `fail` and `drop` nodes.

This is computed before the rules below are applied, and it is why a gather needs no marker of its own: the shape of the graph identifies it. Nested splits are found the same way; a split inside Region(b) has its own gather, which must itself lie in Region(b).

A gather **can miss its need** when a required branch can reach a `drop` node (`need: "all"`), or when the branches that can reach a `drop` node outnumber M minus `need` (a number or `"any"`). A gather **can leave losers** when `need` is `"any"` or a number below M, or when it can miss its need.

A validator MUST reject each of these before any side effect.

| ID | Rule |
| --- | --- |
| P1 | A split, `drop` node, or `need`, `optional` or `losers` member in a definition that doesn't declare `parallel` |
| P2 | A split with no gather by step 3 above, or with more than one candidate; a branch target with no path to the gather |
| P3 | Two regions of one split that share a node |
| P4 | A node in a region that routes outside its region, except to its gather, a `fail` node or a `drop` node |
| P5 | A route into a region from anywhere but its split; a route into a gather from outside its regions |
| P6 | A `complete` node inside a region |
| P7 | A region node with no path to its gather, a `fail` node or a `drop` node |
| P8 | A route array that isn't in ascending order or has a duplicate; a `need` number outside 1..M; `need`, `optional` or `losers` on a node that isn't a gather; an `unmet` route on a node that isn't a gather, or on a gather that cannot miss its need |
| P9 | A gather that can miss its need and has no `unmet` route; a terminal gather that can miss its need |
| P10 | `optional` beside a `need` other than `"all"` or M; a gather whose arrivals are all optional, because it could start with nothing; a branch with several routes into the gather where only some carry `optional` |
| P11 | A mapping in a region that reads another region of its split |
| P12 | Two regions of one split that wait on the same signal name |
| P13 | `losers: "stop"` on a gather that can leave losers and has an `unsafe` activity in one of its regions |
| P14 | A route to a `drop` node from a node that isn't in a region |
| P15 | A node that is the gather of more than one split; the gather of a nested split outside the region that contains the nested split |

These rules keep the design sound by shape: every path from a split reaches its gather or ends deliberately, so a gather can't wait for an arrival that will never come for a structural reason. A step that never returns can still hold a gather (see §10).

A `fail` node may be shared by nodes inside and outside a split, since it is in no region. After the gather, a mapping may read `nodes.<region node>` as in core. A region node that didn't run is a missing path, as it is for any core node that wasn't visited.

## 7. Execution

1. Without a split, execution is exactly core. The state holds one position per open branch instead of one. No new event type is needed: a `result` names its invocation, a `signal` names its waiting node, and `resolve` names its invocation.
2. Taking a split is one transition. It enters the branch targets in array order, and commands follow that order. If entering any target fails (a mapping error or a limit), the transition emits no invoke commands for the split and proceeds as in Failure below, which also covers branches of an enclosing split that are already open.
3. A route into a gather ends the branch and records an **arrival**: the branch, the outcome and the output. An arrival is not a visit. The gather counts one visit when it is entered.
4. A route to a `drop` node ends the innermost branch and records no arrival.
5. After each arrival or drop, the gather decides, once per visit of S:
   - **Met** when every required branch has arrived, every optional branch has arrived or dropped, and, for a numeric `need`, the arrivals reach the number.
   - **Unmet** when that can no longer happen: a required branch dropped under `need: "all"`, or the arrivals plus the open branches can no longer reach a numeric `need`.
   - With `losers: "wait"`, neither decision is taken until every branch has finished. Dropped branches have finished.
6. On a decision with `losers: "stop"`, waiting branches are discarded and each open invocation gets a cancel command, in array order and depth-first for nested splits. A later result is stale and is never recorded. An invocation parked on an unknown result is open and gets the cancel command too. With `losers: "wait"`, every branch has finished before the decision, and results of those branches are arrivals too.
7. On met, the gather is entered according to its kind: an `activity` computes its input (it can read `arrivals`) and is invoked; an `await-signal` starts waiting; a `complete` evaluates its output and ends the run; a `fail` ends the run. On unmet, the gather is not entered; its record and `from` are written as §4 says, and the run takes the `unmet` route.
8. **First means first accepted**, in the run's serial event order (execution §5), not first finished by wall clock. Fixtures compare traces given an event order.
9. A signal matches a position that is waiting at an `await-signal` node with that name, whatever the run's overall status is. P12 guarantees at most one such position per split.
10. An invocation with an unknown result parks its branch for intervention under the core rules: at once for an `unsafe` action, and once attempts run out for any other. Other branches continue. Run status precedence is `needs-intervention`, `stopping`, `running`, `waiting`.
11. Re-entering a split is a new visit of S. Results of the previous visit are stale, and retries inside a branch stay ordinary core loops. A branch can be entered only from its split, so going back after the gather reruns the whole split.

### Failure

Core already ends the run as `failed` when an operational failure has no `failed` route (execution §3). This profile says what that means while other branches run:

1. A failure with no `failed` route, or a `fail` node, in any branch ends the run as `failed`, overriding `losers`.
2. Every other branch stops at once, and each open invocation gets a cancel command.
3. A running `unsafe` invocation is the exception. It gets the cancel request like the others, but the run doesn't end until that invocation has a known result. §9 proposes this as a core rule, because the same question arises when a person cancels a run.

An author who wants a failure tolerated draws a `failed` route: to a `drop` node, to a retry path, or to a waiting node.

## 8. Why this shape

**Why fail at once.** Of 17 systems checked for their default when a parallel branch fails with no handling, 11 end the run as failed without asking anyone, and 3 leave the failed path waiting for a person. Three have no complete answer. Some cells are inferred, so treat the table as a summary, not a citation of each engine's guarantee.

| Default | Systems |
| --- | --- |
| Run fails, everything stops at once | [Step Functions](https://docs.aws.amazon.com/step-functions/latest/dg/state-parallel.html), [Serverless Workflow](https://github.com/open-workflow-specification/specification/blob/main/dsl.md), [n8n](https://docs.n8n.io/flow-logic/execution-order/) |
| Run fails, other work finishes, dependants don't run | [GitHub Actions](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-jobs), [Argo](https://argo-workflows.readthedocs.io/en/latest/walk-through/dag/), [Airflow](https://airflow.apache.org/docs/apache-airflow/stable/core-concepts/tasks.html), [Dagster](https://github.com/dagster-io/dagster/blob/master/python_modules/dagster/dagster/_core/execution/plan/active.py), [Logic Apps](https://learn.microsoft.com/en-us/azure/logic-apps/error-exception-handling), [Jenkins](https://www.jenkins.io/doc/book/pipeline/syntax/) |
| Run fails if code doesn't catch the error | [Temporal](https://docs.temporal.io/references/failures), [Durable Functions](https://learn.microsoft.com/en-us/azure/azure-functions/durable/durable-functions-error-handling) |
| Failed path waits for a person | [Cylc](https://cylc.github.io/cylc-doc/stable/html/user-guide/running-workflows/workflow-completion.html), [Camunda 8](https://docs.camunda.io/docs/components/concepts/incidents/), [ecFlow](https://ecflow.readthedocs.io/en/latest/glossary.html) |
| No complete answer in the source | [BPMN 2.0](https://www.omg.org/spec/BPMN/2.0.2/PDF), [SCXML](https://www.w3.org/TR/scxml/), [XState](https://stately.ai/docs/invoke) |

**Why `need` defaults to `all`.** The validator has to work out which node the branches meet at anyway (§6), so asking the author to also write `need="all"` adds nothing but a chance to forget it. Every system in the table above waits for everything by default. In DOT the split itself stays explicit through the group syntax, so a default on the gather can't hide a mistake.

**Alternatives considered:**

| Alternative | Why it lost |
| --- | --- |
| Paired `fork` and `join` kinds with a validated region | It has the same guarantees as this design but adds a node the author must draw and keep paired. The node that waits should itself be the gather |
| A rule on the target with no region checks (Airflow, Argo) | A node behind an either/or path would wait forever, unless the engine also tracks skipped paths, as [BPEL](https://docs.oasis-open.org/wsbpel/2.0/OS/wsbpel-v2.0-OS.html) §11.6 does |
| Free `fork` and `join` kinds (BPMN) | Deadlocks and accidental double runs reach run time, and catching them needs state-space analysis. The rules here can loosen into this later; the reverse can't happen once workflows rely on it |
| Nested blocks ([ASL](https://states-language.net/spec.html)) | `nodes` becomes a tree of maps with new ID scoping, which isn't drawable in flat SWL-DOT |
| A name on each arrow, or DOT ports | Every arrow gets another attribute, and names can contradict the graph. Ports also print a Graphviz warning for each input |
| A condition on the node (`when="a and b"`) | It repeats the graph in a string and requires an expression language. It can arrive later as another value |
| Requiring `need` on every gather | A gather is already identified by shape; see above |
| A gather only on `activity` nodes | "Run two things, then the run is done" would need a dummy activity before `complete` |
| A missing optional arrival is a missing path | No conformant mapping could read an optional arrival, because the minimal profile has no fallback operator. `null` needs nothing new |
| A result with no route ends the branch | A misspelled outcome would silently end a branch |
| Letting losers run on and ignoring them | Work keeps running that nothing tracks, possibly overlapping the next node. Step Functions documents this: invoked Lambda functions "continue to run" |
| Abandoning an unsafe invocation on failure | It can leave no way to know whether the effect happened |

## 9. Compatibility and core changes

- Additive behind `requires`, as conformance §5 permits for a feature gate. A definition without `parallel` behaves exactly as today, with one exception: the `stopping` rule below is a core change and alters the trace of a core definition whose `unsafe` invocation is cancelled while running.
- New kinds, a route array and new members all fail closed in a conformant validator. **Known gap:** the TypeScript draft's `validateDefinition` accepted an unknown `join` member on an activity at commit `32ba88d`, while the schema rejected it. Validators need to enforce closed members before this ships.
- Changes needed in the spec text: definition §2 (`unmet` joins the reserved outcomes), §3 (the `drop` kind, a route array, gather members on every kind, and "a path to a terminal" is satisfied inside a region by a path to the gather, a `fail` node or a `drop` node, while a `drop` node itself is exempt), §5 (the `arrivals` path and `from` at a gather); notation §2 and §3; execution §1 ("exactly one active position"), §2 and §5 (signal matching per position); state §3 (the `stopping` status); conformance §3; and `schemas/definition.schema.json`. `state.md` §3 already says "active position(s)".
- The notation change lifts a rejection for one narrow form of subgraph, which notation §2 allows for an unambiguous extended frontend.

**Proposed core change: an `unsafe` invocation outlives a stop.** Today the `cancel` event sends a cancel command to the open invocation whatever its effect, and the run is `cancelled` at once. That abandons an `unsafe` effect whose outcome nobody will ever learn. The proposal, for core, so that a cancel and a parallel failure behave alike:

1. When a run is about to end as `failed` or `cancelled` while an `unsafe` invocation is running, or is parked on an unknown result, the run enters a new status, `stopping`, and the pending end (`failed` with its error, or `cancelled`) is recorded in the state.
2. Everything else stops as it would have. The `unsafe` invocation gets the cancel command too, since a request to stop is not the same as a known result (invocation §5), but the run waits for its result.
3. A known result, whether success or failure, is recorded in `nodes.<id>` and the run ends with the pending end. No further attempt is made, even when the failure is retryable, and the outcome does not route anywhere.
4. An `unknown` result shows the run as `needs-intervention`, as core requires. A `resolve` as `complete` or `fail` records the result and the run ends with the pending end. A `resolve` as `retry` invokes the action again and the run stays `stopping`. A run never ends while an `unsafe` result is unknown.
5. A `cancel` event during `stopping` is recorded as a diagnostic and changes nothing; the pending end stays what it was.
6. A deadline on the invocation (invocation §5) bounds how long a run can stay `stopping`.

This also answers what happens when one branch fails while a sibling is already parked on an unknown `unsafe` result: the run goes `stopping` and waits for the resolution. The change needs its own core fixture: cancel of a running `unsafe` invocation, today `cancelled` plus a cancel command, afterwards `stopping` plus the cancel command, then `cancelled` once the result arrives.

## 10. Security and resource limits

- Fan-out multiplies work, so hosts SHOULD advertise a concurrency limit in their conformance manifest.
- Capabilities are checked for the whole definition before any effect (definition §4); nothing here checks them per branch.
- A branch that never finishes holds its gather, and an `unsafe` invocation with no deadline holds a `stopping` run open. `timers` are out of scope, so hosts SHOULD apply deadlines to invocations (question 2).
- Cancel commands are requests, and cancellation isn't proof of reversal (execution §5). P13 and the `stopping` rule exist for that reason.

## 11. Tests

Fixtures land with the spec text, per step 4 of GOVERNANCE.md, in the format [#10](https://github.com/Web-tree/spore-workflow-language/issues/10) defines.

**Positive traces:**

- Default `need` (all) in both arrival orders, with a `complete` gather and with an `activity` gather.
- `need: "any"` with cancels and a stale late result.
- `need: 2` of 3 met early; unmet early, taking `unmet`, with the `unmet` target reading `nodes.<gather>.arrivals`.
- Unmet under `losers: "wait"`: the decision waits for the last branch.
- `losers: "wait"`: late results become arrivals.
- Optional arrival present; optional branch dropped and read as `null`; optional branch still running holds the gather.
- A later node reads `nodes.<gather>.arrivals`.
- A shared `fail` node reached from inside and outside a split (accepted; the run fails).
- A retry inside a branch counts as one arrival.
- Nested split and gather; a mapping failure in a nested branch cancels the open branches of the enclosing split.
- A core merge inside a branch.
- A signal delivered to a waiting branch while a sibling branch is `running`.
- A re-entered split with no carry-over, and a stale result from the previous visit.
- Failure with no `failed` route stops the others; `fail` node stops the others.
- Failure while an `unsafe` invocation runs: status `stopping`, cancel command sent, it finishes, its result is recorded, then the run fails.
- Failure while a sibling is parked on an unknown `unsafe` result: `needs-intervention`, resolution, then the run fails.
- During `stopping`: a retryable failure ends the run without another attempt; `resolve retry` keeps `stopping`; a second `cancel` changes nothing.
- Cancel of a run with several open invocations, with and without an `unsafe` one.
- A parked `read-only` loser under `losers: "stop"` gets a cancel command.
- Duplicate result.
- A core definition's trace is unchanged, except for the `stopping` core fixture in §9.

**Negative:** P1 to P15 each, including a `losers: "stop"` gather with an `unsafe` region that *cannot* leave losers, which MUST be accepted; a nested split whose branches join at the outer gather (P15); a branch that only drops (P2); a DOT group with a name, attribute or nested statement; a DOT port; two same-outcome edges without a group; `need` overridden in settings; a host without `parallel` emits no commands.

## 12. Open questions

1. When a split is re-entered, should its `nodes` entries be cleared, or scoped per visit of S?
2. Does `parallel` need `timers` for a conformance claim, given that a branch can wait forever?
3. Should a cancelled invocation have a distinct result status? Today it would report a generic failure.
4. Should a terminal gather be allowed an `unmet` route later, as the one exception to "terminal nodes have no routes"? This draft forbids it (P9) and asks the author to insert an activity.
5. Are overlapping graphs common enough to justify a later, looser profile?
