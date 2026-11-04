# RFC 0001: the `parallel` profile

**Status:** Draft proposal. Nothing here is normative. **Issue:** [#6](https://github.com/Web-tree/spore-workflow-language/issues/6). **Against:** draft commit `eecc69e`.

This RFC follows step 2 of [GOVERNANCE.md](../GOVERNANCE.md): scope, normative behavior, compatibility, security, and positive and negative tests. Nothing has been implemented or run. Every name it introduces (`need`, `optional`, `unmet`, `losers`, `end`, `inputs`) is a working name, and the rules are expected to change once an implementation produces traces.

## 1. Summary

A definition that requires `parallel` can start several branches at once and have one node wait for them. There is no separate fork or join node. An ordinary node takes several inputs and says how many it needs:

~~~dot
digraph "ci" {
  start = "build";
  build -> {lint test};
  {lint test} -> publish;
  publish [need="all"];
  publish -> done;
  done [kind="complete"];
}
~~~

Each of `lint` and `test` starts a **branch**, which runs under the unchanged sequential rules. `publish` is a **gather**: it starts when its `need` is met, and it reads what each branch delivered.

## 2. Terms

- **Split:** one outcome routed to two or more nodes, which then start together.
- **Branch:** one path running after a split. A branch has one active position and follows the core rules.
- **Gather:** a node with a `need` member. It receives one input per branch.
- **Input:** what one branch delivered to a gather. It is named after the branch's first node.
- **Loser:** a branch still running when its gather has decided.
- **Region(b):** every node reachable from branch b's first node without passing the gather.

Do not confuse a gather with a **merge**. In a merge, several routes reach a node but only one is ever taken, because the paths are alternatives. Core merges are unchanged by this RFC.

## 3. Scope

**In scope:** nested splits and gathers, `need` of `all`, `any` or a number, optional inputs, stopping or waiting for losers, failure while branches run, and checking an action's input before it starts.

**Out of scope, and rejected by validators until specified:**

- Running a node once per arrival. Copies would multiply through every later node, and the first to reach a `complete` node would end the run while others still work. Placing the work inside each branch covers most uses.
- A custom condition or a node deciding for itself. A condition needs the expression profile, which has no text yet. A node that decides on each arrival shares the problem above, and validation can't show that it ever decides.
- Graphs whose branches overlap without nesting (`a -> d; b -> d; b -> e`), dynamic fan-out over a list, compensation, and timers.

## 4. Definition model

A definition using any of this MUST declare `"requires": ["core", "parallel"]`.

**A split.** A route value may be an array of two or more node IDs:

~~~json
{ "build": { "kind": "activity", "action": "build",
             "routes": { "ok": ["lint", "test"] } } }
~~~

**A gather.** Any `activity` node may carry these members:

| Member | Values | Meaning |
| --- | --- | --- |
| `need` | `"all"`, `"any"`, or an integer from 2 to M-1, where M is the number of branches | How many inputs the node needs. `"any"` is 1 |
| `optional` | Array of input names | Inputs the node can start without. Only with `need: "all"` |
| `losers` | `"stop"` (default) or `"wait"` | What happens to branches still running when the node decides |

**A branch end.** A new node kind, `end`, has no members. A route to it ends the branch and delivers nothing. Several branches may share one `end` node.

**`unmet`.** A reserved outcome, like `exhausted`. A gather takes its `unmet` route, without running its action, when its need can no longer be met.

**Reading inputs.** A mapping path may begin with `inputs` on a gather: `{"$get": ["inputs", "test", "output"]}`. Each input is `{outcome, output}`. An optional input may be missing, and missing paths are errors (definition §5), so a read of one needs a declared fallback, which the minimal expression profile doesn't have yet (question 3).

## 5. SWL-DOT

| Location | Attribute | Meaning |
| --- | --- | --- |
| node | `need`, `losers` | As in §4 |
| node | `kind` | Also accepts `end` |
| edge | `optional` | `true` marks the arrow's branch as an optional input. It normalizes to the gather's `optional` list |

A subgraph is accepted only as an unnamed, attribute-free group of node IDs at either end of an edge. Per the [DOT language](https://graphviz.org/doc/info/lang.html), `A -> {B C}` is equivalent to `A -> B` and `A -> C`, so a parser normalizes it to two edges. Named subgraphs, clusters, nested groups, statements inside a group, and ports stay rejected.

`a -> b; a -> c` with the same outcome normalizes to a split. If those paths don't meet at one gather, it remains the existing duplicate-route error, so a typo stays an error. These attributes are authoritative in DOT, and `settings.json` MUST NOT override them.

## 6. Static rules

A validator MUST reject each of these before any side effect.

| ID | Rule |
| --- | --- |
| P1 | A split, gather, `end` node or `need` member in a definition that doesn't declare `parallel` |
| P2 | A split whose branches don't all meet at one gather; a gather that isn't the meeting point of exactly one split |
| P3 | Two regions of one split that share a node, `fail` and `end` nodes excepted |
| P4 | A node in a region that routes outside its region, except to its gather, a `fail` node or an `end` node |
| P5 | A route into a region from anywhere but its split; a route into a gather from outside its regions |
| P6 | A `complete` node inside a region |
| P7 | A region node with no path to its gather, a `fail` node or an `end` node |
| P8 | A `need` number outside 2..M-1; a need no combination of arrivals can meet |
| P9 | A gather that can miss its need and has no `unmet` route |
| P10 | `optional` beside a `need` other than `"all"`; a gather whose inputs are all optional; a branch with several routes into the gather where only some are marked optional |
| P11 | A mapping in a region that reads another region of its split; a mapping outside a split that reads inside it, other than through the gather (question 4) |
| P12 | Two regions of one split that wait on the same signal name |
| P13 | `losers: "stop"` on a gather with an `unsafe` activity in one of its regions |

These rules keep the design sound by shape: every path from a split reaches its gather or ends deliberately, so a gather can't wait for an arrival that will never come for a structural reason. A step that never returns can still hold a gather (see §10).

Several routes into a node without `need` remain a core merge. If those routes could be taken at the same time, P2 rejects the definition.

## 7. Execution

1. Without a split, execution is exactly core. Each split activation creates one branch per target, each with one position and core rules.
2. Taking a split is one transition. It enters branches in ascending key order, and commands follow that order. Presentation never affects order.
3. A route into a gather ends the branch and records an **arrival**: the branch, the outcome and the output. An arrival is not a visit. The gather counts one visit per split activation.
4. A route to an `end` node ends the branch and records no arrival.
5. After each arrival or branch end, the gather decides, once per split activation:
   - **Met** when arrivals reach `need` and every optional branch has finished. With `losers: "wait"`, every branch must also have finished.
   - **Unmet** when arrivals plus open branches can no longer reach `need`. A required branch that ends without arriving makes `need: "all"` unmet.
6. On a decision with `losers: "stop"`, waiting branches are discarded and each open invocation gets a cancel command, in key order. A later result is stale and is never recorded. With `losers: "wait"`, every branch has finished before the decision, and results of those branches are inputs too.
7. On met, the gather enters as an activity with its inputs. On unmet, the run takes the `unmet` route without invoking the action.
8. **First means first accepted**, in the run's serial event order (execution §5), not first finished by wall clock. Fixtures compare traces given an event order.
9. An `unsafe` invocation with an unknown result parks its branch for intervention, as in core. Other branches continue. Run status precedence is `needs-intervention`, `running`, `waiting`.
10. Re-entering a split is a new activation. Results of the previous activation are stale, and retries inside a branch stay ordinary core loops. A branch can be entered only from its split, so going back after the gather reruns the whole split.

### Failure

Core already ends the run as `failed` when an operational failure has no `failed` route (execution §3). This profile says what that means while other branches run:

1. A failure with no `failed` route, or a `fail` node, in any branch ends the run as `failed`, overriding `losers`.
2. Every other branch stops at once, and each open invocation gets a cancel command.
3. **Exception:** an invocation of an `unsafe` action that is running is not cancelled. The run stays open until it reports a result or reaches its deadline, and then ends as `failed`, with that result recorded. Nobody then has to guess whether the effect happened.

An author who wants a failure tolerated draws a `failed` route: to an `end` node, to a retry path, or to a waiting node.

### Checking an action's input

`inputSchema` on an action contract (definition §4) has no stated time of checking. Under this profile, a host MUST check the computed input against it before authorizing the invocation. A misfit is an operational failure with code `input.invalid`, so it takes the `failed` route, and without one it ends the run. It is in this RFC because what a gather receives can now differ between runs when an input is optional or `need` is a number.

## 8. Why this shape

**Why fail at once.** Of 17 systems checked for their default when a parallel branch fails with no handling, 11 end the run as failed without asking anyone, and 3 leave the failed path waiting for a person. Three have no complete answer. Some cells are inferred, so treat the table as a summary, not a citation of each engine's guarantee.

| Default | Systems |
| --- | --- |
| Run fails, everything stops at once | [Step Functions](https://docs.aws.amazon.com/step-functions/latest/dg/state-parallel.html), [Serverless Workflow](https://github.com/open-workflow-specification/specification/blob/main/dsl.md), [n8n](https://docs.n8n.io/flow-logic/execution-order/) |
| Run fails, other work finishes, dependants don't run | [GitHub Actions](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-jobs), [Argo](https://argo-workflows.readthedocs.io/en/latest/walk-through/dag/), [Airflow](https://airflow.apache.org/docs/apache-airflow/stable/core-concepts/tasks.html), [Dagster](https://github.com/dagster-io/dagster/blob/master/python_modules/dagster/dagster/_core/execution/plan/active.py), [Logic Apps](https://learn.microsoft.com/en-us/azure/logic-apps/error-exception-handling), [Jenkins](https://www.jenkins.io/doc/book/pipeline/syntax/) |
| Run fails if code doesn't catch the error | [Temporal](https://docs.temporal.io/references/failures), [Durable Functions](https://learn.microsoft.com/en-us/azure/azure-functions/durable/durable-functions-error-handling) |
| Failed path waits for a person | [Cylc](https://cylc.github.io/cylc-doc/stable/html/user-guide/running-workflows/workflow-completion.html), [Camunda 8](https://docs.camunda.io/docs/components/concepts/incidents/), [ecFlow](https://ecflow.readthedocs.io/en/latest/glossary.html) |
| No complete answer in the source | [BPMN 2.0](https://www.omg.org/spec/BPMN/2.0.2/PDF), [SCXML](https://www.w3.org/TR/scxml/), [XState](https://stately.ai/docs/invoke) |

**Alternatives considered:**

| Alternative | Why it lost |
| --- | --- |
| Paired `fork` and `join` kinds with a validated region | It has the same guarantees as this design but adds a node the author must draw and keep paired. The node that waits should itself say that it takes several inputs |
| A rule on the target with no region checks (Airflow, Argo) | A node behind an either/or path would wait forever, unless the engine also tracks skipped paths, as [BPEL](https://docs.oasis-open.org/wsbpel/2.0/OS/wsbpel-v2.0-OS.html) §11.6 does |
| Free `fork` and `join` kinds (BPMN) | Deadlocks and accidental double runs reach run time, and catching them needs state-space analysis. The rules here can loosen into this later; the reverse can't happen once workflows rely on it |
| Nested blocks ([ASL](https://states-language.net/spec.html)) | `nodes` becomes a tree of maps with new ID scoping, which isn't drawable in flat SWL-DOT |
| A name on each arrow, or DOT ports | Every arrow gets another attribute, and names can contradict the graph. Ports also print a Graphviz warning for each input |
| A condition on the node (`when="a and b"`) | It repeats the graph in a string and requires an expression language. It can arrive later as another value |
| A result with no route ends the branch | A misspelled outcome would silently end a branch |
| Letting losers run on and ignoring them | Work keeps running that nothing tracks, possibly overlapping the next node. Step Functions documents this: invoked Lambda functions "continue to run" |
| Cancelling an unsafe invocation on failure | It can leave no way to know whether the effect happened |

## 9. Compatibility

- Additive behind `requires`, as conformance §5 permits for a feature gate. A definition without `parallel` behaves exactly as today.
- New kinds, a route array and new members all fail closed in a conformant validator. **Known gap:** the TypeScript draft's `validateDefinition` accepted an unknown `join` member on an activity at commit `32ba88d`, while the schema rejected it. Validators need to enforce closed members before this ships.
- Changes needed: execution §1 ("in `core`, a run has…"), definition §3, §5, notation §2 and §3, conformance §3, and `schemas/definition.schema.json`. `state.md` already says "active position(s)".
- The notation change lifts a rejection for one narrow form of subgraph, which notation §2 allows for an unambiguous extended frontend.

Separately from this profile, the core should state the merge rule outright, and define `from.outcome` after `exhausted`.

## 10. Security and resource limits

- Fan-out multiplies work, so hosts SHOULD advertise a concurrency limit in their conformance manifest.
- Capabilities for all branches MUST be checked before any effect, not per branch. A definition still can't authorize itself.
- A branch that never finishes holds its gather, and an unsafe invocation with no deadline holds a failing run open. `timers` are out of scope, so hosts SHOULD apply deadlines to invocations (question 5).
- Cancel commands are requests, and cancellation isn't proof of reversal (execution §5). P13 and the failure exception exist for that reason.

## 11. Tests

Fixtures land with the spec text, per step 4 of GOVERNANCE.md.

**Positive traces:**

- `need: "all"` in both arrival orders.
- `need: "any"` with cancels and a stale late result.
- `need: 2` of 3 met early; unmet early, taking `unmet`.
- `losers: "wait"`: late results become inputs.
- Optional input present; optional branch ended at `end`; optional branch still running holds the gather.
- A retry inside a branch counts as one input.
- Nested split and gather.
- A core merge inside a branch.
- A re-entered split with no carry-over, and a stale result from the previous activation.
- Failure with no `failed` route stops the others; `fail` node stops the others.
- Failure while an unsafe invocation runs: it finishes, its result is recorded, then the run fails.
- An unsafe unknown result parks one branch while its sibling continues.
- `input.invalid` with and without a `failed` route.
- Duplicate result, and run cancel.
- A core definition's trace is unchanged.

**Negative:** P1 to P13 each; a DOT group with a name, attribute or nested statement; a DOT port; `need` overridden in settings; a host without `parallel` emits no commands.

## 12. Open questions

1. Are these working names right? `inputs` sits one letter from the existing `input` path, which seems likely to cause mistakes; `arrivals` is one alternative.
2. Which kinds can be a gather? This draft says `activity`. Mixed rules ("a, and either b or c") need a nested split with an extra gather, and every activity needs an action. A gather with no action would remove that cost.
3. How does a mapping read an optional input, given that missing paths are errors and the minimal profile has no fallback operator?
4. How do later nodes read what a gather received? Region nodes are unreadable from outside (P11), so the gather's record could keep its inputs, for example `nodes.<gather>.inputs`.
5. Does `parallel` need `timers` for a conformance claim, given that a branch can wait forever?
6. Should a cancelled invocation have a distinct result status? Today it would report a generic failure.
7. When a split is re-entered, should its `nodes` entries be cleared, or scoped per activation?
8. Should the run fail when another branch is parked on an unsafe unknown result, or should it hold until that is resolved? This draft fails the run and keeps the unknown result in its record, but no test or implementation has checked that.
9. Should checking `inputSchema` before invocation apply to all definitions, rather than only under this profile? That would change core behavior for existing definitions.
10. Are overlapping graphs common enough to justify a later, looser profile?
