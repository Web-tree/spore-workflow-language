# The `parallel` profile

**Status:** Draft normative profile. **Part:** execution profile `parallel`. **Requires:** definition and execution; source-notation for the SWL-DOT part. **Origin:** [RFC 0001](../rfcs/0001-parallel-profile.md), accepted 2026-11-04. **Fixtures:** `fixtures/*/parallel-*.json`.

A definition that requires `parallel` can start several branches at once and have one node wait for them. There is no separate fork or join node. The node where the branches meet waits for all of them unless it says otherwise:

~~~dot
digraph "ci" {
  start = "build";
  build -> {lint test};
  {lint test} -> done;
  done [kind="complete"];
}
~~~

`build -> {lint test}` is a **split**: `lint` and `test` start together, and each then runs under the unchanged core rules. `done` is a **gather**: the node where the branches meet. It needs no attribute to wait for both. A gather that should start earlier says how many arrivals it needs, `need="any"` or a number.

## 1. Terms

- **Split:** one outcome routed to two or more nodes, which then start together. The node that holds the split route is called S below, and M is the number of its targets.
- **Branch:** one path running after a split. A branch has one active position and follows the core rules. A branch is named after its first node, the split target.
- **Gather:** the node where the branches of one split meet. §3 says how it is found from the shape of the graph.
- **Arrival:** what one branch delivered to its gather: the outcome and output of the route that reached it.
- **Drop:** a node kind that ends a branch with no arrival.
- **Loser:** a branch still running when its gather has decided.
- **Region(b):** the nodes of branch b, as §3 defines them. The gather, `fail` nodes and `drop` nodes are never in a region.

A gather is not a **merge**. In a merge, several routes reach a node but only one is ever taken, because the paths are alternatives (execution §2). Merges inside a branch are unchanged by this profile.

## 2. Definition model

A definition using anything in this profile MUST declare `"requires": ["core", "parallel"]`. `parallel` does not stand alone.

**A split.** A route value may be an array of two or more node IDs, listed in ascending order with no duplicates:

~~~json
{ "build": { "kind": "activity", "action": "build",
             "routes": { "ok": ["lint", "test"] } } }
~~~

**A gather.** A node is a gather when it is the meeting point of a split (§3). Any node kind can be a gather, and only a gather may carry these members:

| Member | Values | Meaning |
| --- | --- | --- |
| `need` | `"all"` (default), `"any"`, or an integer from 1 to M | How many arrivals the node needs. `"any"` means 1 and `M` means `"all"` |
| `optional` | Array of branch names | Branches whose arrival may be missing because the branch ended at a `drop` node. Only with `need: "all"`. A missing optional arrival is recorded as `null` under its name |
| `losers` | `"stop"` (default) or `"wait"` | What happens to branches still running when the node decides |

**A branch end.** The node kind `drop` has no members. A route to it ends the innermost branch and delivers nothing. A `drop` node is never entered: it counts no visit, has no `nodes` entry, and is not subject to `maxVisitsPerNode`. Several branches may share one `drop` node, and only region nodes may route to it.

**`unmet`.** A reserved outcome, like `exhausted` (definition §2). A gather takes its `unmet` route, without being entered, when its need can no longer be met. The gather's record then becomes `{visit, outcome: "unmet", output: null, arrivals}` with `visit` unchanged, and at the target `from` is `{node: <gather>, outcome: "unmet", output: null}`, so the `unmet` handler can read who did arrive.

**Reading arrivals.** A mapping path may begin with `arrivals` on a gather: `{"$get": ["arrivals", "test", "output"]}`. `arrivals` is an object with one member per finished branch, named after the branch: `{outcome, output}` for an arrival, or `null` for an optional branch that dropped. Branches that were still running when the gather decided have no member. When the gather is entered, `nodes.<gather>` is written as `{visit, arrivals}` so later nodes can read them; when it routes on, its record is `{visit, outcome, output, arrivals}`. At a gather, `from` is null, as it is at `start`.

## 3. Static rules

**Finding the gather.** For a split at node S with targets T1..TM:

1. R(t) is the set of nodes reachable from target t along routes that don't pass through S, leaving out `fail` and `drop` nodes.
2. C is the set of nodes that are in R(t) for two or more targets.
3. The gather G is the one node of C such that, with G removed from the graph, no node of C is reachable from any target along routes that don't pass through S. In words: every way from a branch into the shared part of the graph goes through G first.
4. Region(b) is the set of nodes reachable from target b along routes that pass through neither S nor G, leaving out `fail` and `drop` nodes.

This is computed before the rules below are applied, and it is why a gather needs no marker of its own: the shape of the graph identifies it. Nested splits are found the same way; a split inside Region(b) has its own gather, which must itself lie in Region(b). A nested split's **containing region** is the smallest region that holds its split node.

A branch **can drop** when a node of its region that is not inside a nested region routes to a `drop` node. A gather **can miss its need** when a branch that is not optional can drop (`need: "all"`), or when the branches that can drop outnumber M minus `need` (a number or `"any"`). A gather **can leave losers** when `need` is below M, or when it can miss its need.

A validator MUST reject each of these before any side effect, with the code `parallel.p<n>`:

| ID | Rule |
| --- | --- |
| P1 | A split, `drop` node, `unmet` route, or `need`, `optional` or `losers` member in a definition that doesn't declare `parallel`; `parallel` without `core` |
| P2 | A split with no gather by step 3 above, or with more than one candidate; a branch target that is the gather or has no path to it |
| P3 | Two regions of one split that share a node |
| P4 | A node in a region that routes outside its region, except to its gather, a `fail` node or a `drop` node |
| P5 | A route into a region from anywhere but its split's own split route; a route into a gather from outside its regions; `start` inside a region or at a gather |
| P6 | A `complete` node inside a region |
| P7 | A region node with no path to its gather, a `fail` node or a `drop` node |
| P8 | A route array that isn't in ascending order or has a duplicate; a `need` that isn't `"all"`, `"any"` or an integer in 1..M; a `losers` that isn't `"stop"` or `"wait"`; `need`, `optional` or `losers` on a node that isn't a gather; an `unmet` route on a node that isn't a gather, or on a gather that cannot miss its need |
| P9 | A gather that can miss its need and has no `unmet` route; a terminal gather that can miss its need |
| P10 | `optional` beside a `need` other than `"all"` or M; an `optional` name that isn't a branch of the split; a gather whose arrivals are all optional, because it could start with nothing |
| P11 | A mapping in a region that reads `nodes.<id>` for a node of another region of the same split; a mapping that reads `arrivals` on a node that isn't a gather |
| P12 | Two regions of one split that wait on the same signal name |
| P13 | `losers: "stop"` on a gather that can leave losers, with an `unsafe` activity in one of its regions |
| P14 | A route to a `drop` node from a node that isn't in a region |
| P15 | A node that is the gather of more than one split; a nested split whose gather or regions lie outside its containing region |

P3 and P7 follow from P2 and the core rule that every node has a path to a terminal (definition §3): a shared node would stop step 3 from finding a single gather, and a region node's only ways out are its gather, a `fail` node, a `drop` node or (P4) its split. They are listed so that an implementation that checks regions directly reports the same thing, and have no fixture of their own.

These rules keep the design sound by shape: every path from a split reaches its gather or ends deliberately, so a gather can't wait for an arrival that will never come for a structural reason. A step that never returns can still hold a gather (§6).

A `fail` node may be shared by nodes inside and outside a split, since it is in no region. After the gather, a mapping may read `nodes.<region node>` as in core. A region node that didn't run is a missing path, as it is for any core node that wasn't visited. Inside a region, the core requirement of a path to a terminal is satisfied by a path to the gather, a `fail` node or a `drop` node; a `drop` node itself is exempt from it.

## 4. Execution

1. Without a split, execution is exactly core. The state holds one position per open branch instead of one (execution §1). No new event type is needed: a `result` names its invocation, a `signal` names its waiting node, and `resolve` names its invocation.
2. Taking a split is one transition. It records the split node's result as usual, enters the branch targets in array order, and its commands follow that order. `from` at each target names the split node and its outcome. If entering any target fails (a mapping error or a limit), the transition emits no invoke command for the split and proceeds as in §5, which also covers branches of an enclosing split that are already open.
3. A route into a gather ends the branch and records an **arrival**: the outcome and output the route carried. An arrival is not a visit of the gather. The gather counts one visit when it is entered. The branch's last node records its result as any node does.
4. A route to a `drop` node ends the innermost branch and records `null` for it.
5. After each arrival or drop, the gather **decides**, once per visit of S:
   - With `need: "all"`: **met** when every branch that isn't optional has arrived and every optional branch has arrived or dropped; **unmet** when a branch that isn't optional has dropped.
   - With `need: "any"` or a number N: **met** when N arrivals have been recorded; **unmet** when the arrivals plus the branches still open can no longer reach N.
   - With `losers: "wait"`, neither decision is taken until every branch has finished. Dropped branches have finished.
6. On a decision with `losers: "stop"`, every branch still open is a loser. Its position is discarded, and each open invocation, running or parked on an unknown result, gets a cancel command. Losers are handled in array order and depth-first through nested splits, and their cancel commands come before any command of the gather itself. A later result of a loser is stale (`result.stale`) and is never recorded. With `losers: "wait"`, every branch has finished before the decision, and the results of branches that finished after the need was reached are arrivals too.
7. On met, the gather is entered according to its kind: an `activity` computes its input, which can read `arrivals`, and is invoked; an `await-signal` starts waiting; a `complete` evaluates its output and ends the run; a `fail` ends the run. On unmet, the gather is not entered; its record and `from` are written as §2 says, and the run takes the `unmet` route from the gather.
8. **First means first accepted**, in the run's serial event order (execution §5), not first finished by wall clock. Fixtures compare traces given an event order.
9. A signal matches a position that is waiting at an `await-signal` node with that name, whatever the run's overall status is. P12 guarantees at most one such position per split.
10. An invocation with an unknown result parks its branch for intervention under the core rules: at once for an `unsafe` action, and once attempts run out for any other. Other branches continue. The run's status is the highest of its positions' in this order: `needs-intervention`, `stopping`, `running`, `waiting`.
11. Re-entering a split is a new visit of S with no carry-over. Results of the previous visit are stale, and `nodes` entries are overwritten as each node runs again, as in any core loop. Retries inside a branch stay ordinary core loops: one logical invocation, one arrival. A branch can be entered only from its split, so going back after the gather reruns the whole split.

## 5. Failure

Core ends the run as `failed` when an operational failure has no `failed` route, when a mapping fails, when a limit is hit, or when a `fail` node is entered (execution §2, §3). This profile says what that means while other branches run:

1. Any of those, in any branch, ends the run as `failed` at once, overriding `losers`.
2. Every other branch stops, and each open invocation gets a cancel command, in position order.
3. A running or parked `unsafe` invocation is the exception: it gets the cancel command like the others, but the run holds in `stopping` until that invocation has a known result (execution §5). The same rule applies when a run is cancelled.

An author who wants a failure tolerated draws a `failed` route: to a `drop` node, to a retry path, or to a waiting node.

## 6. Security and resource limits

- Fan-out multiplies work, so hosts SHOULD advertise a concurrency limit in their conformance manifest.
- Capabilities are checked for the whole definition before any effect (definition §4); nothing here checks them per branch.
- A branch that never finishes holds its gather, and an `unsafe` invocation with no deadline holds a `stopping` run open. Timers are out of scope, so hosts SHOULD apply deadlines to invocations (invocation §5).
- Cancel commands are requests, and cancellation isn't proof of reversal (execution §5). P13 and the `stopping` rule exist for that reason.

## 7. Out of scope

Rejected by validators until specified: running a node once per arrival; a custom condition deciding a gather; graphs whose branches overlap without nesting; dynamic fan-out over a list; compensation; timers; a terminal gather that can miss its need (P9); a branch that can never reach its gather (P2). RFC 0001 §3 and §8 record why.

## 8. Open questions

1. Does `parallel` need `timers` for a conformance claim, given that a branch can wait forever?
2. Should a cancelled invocation have a distinct result status? Today it reports a generic failure.
3. Should a terminal gather be allowed an `unmet` route later, as the one exception to "terminal nodes have no routes"?
4. Are overlapping graphs common enough to justify a later, looser profile?
