# Conformance Fixtures

**Status:** Draft normative test-format contract. **Part:** fixtures. **Requires:** definition; source-notation for `dot` fixtures; execution for `trace` fixtures. **Issue:** [#10](https://github.com/Web-tree/spore-workflow-language/issues/10).

A fixture is a JSON file under [`fixtures/`](../fixtures/) that an implementation reads and checks itself against, without running any code from this repository. Fixtures are the tests that [GOVERNANCE.md](../GOVERNANCE.md) step 4 says land together with spec text. Their revision is the git commit of this repository, which a conformance manifest names (conformance §1).

When an implementation fails a fixture, either the implementation doesn't conform to the sections the fixture names, or the fixture or the spec is wrong. The second case is a spec issue; the implementation does not silently win (spec/README.md).

## 1. Common members

| Member | Required | Meaning |
| --- | --- | --- |
| `fixture` | yes | `definition`, `dot` or `trace` |
| `title` | yes | One sentence saying what is checked |
| `spec` | yes | The spec sections the fixture tests, for example `"execution §3"` |
| `profiles` | yes | The profiles the fixture needs. An implementation runs a fixture only when it claims every one of them |

An implementation MUST run every fixture whose profiles it all claims, and MUST report the fixtures it skipped. A fixture never depends on another fixture.

## 2. `definition` fixtures

| Member | Required | Meaning |
| --- | --- | --- |
| `definition` | yes | A normalized definition (definition §2) |
| `supported` | no | The profiles the validator is told it supports for this fixture. Default: whatever the implementation claims. Needed to test rejection of an unsupported profile |
| `expect` | yes | `{ "valid": true }` or `{ "errors": [<code>, ...] }` |

A valid fixture passes when the validator reports no error. An invalid fixture passes when the validator reports **every** listed code; it may report more, because an invalid definition can have more wrong with it than the fixture names. Codes are defined in §5.

## 3. `dot` fixtures

| Member | Required | Meaning |
| --- | --- | --- |
| `source` | yes | SWL-DOT text (notation) |
| `settings` | no | The `settings.json` object that accompanies it |
| `expect` | yes | `{ "definition": <normalized definition> }` or `{ "rejected": true }` |

A fixture with a definition passes when the frontend's normalized output equals it, comparing JSON values with member order ignored. A rejected fixture passes when the frontend reports an error. Notation errors have no codes yet, so a rejection is compared only as a fact.

## 4. `trace` fixtures

| Member | Required | Meaning |
| --- | --- | --- |
| `definition` | yes | A valid normalized definition |
| `steps` | yes | An ordered array of `{ "event", "expect" }` |

Steps apply in order, each to the state the previous one produced, starting from no state. Every `expect` member is compared only when present, so a fixture asserts what it is about and nothing else. Private state is never compared (conformance §2).

**Events** are those of execution §1 and invocation §4, with one portable change: an event that names an invocation carries an **invocation reference** instead of the implementation's ID.

| Event | Members |
| --- | --- |
| `start` | `runId`, optional `input` |
| `result` | `invocation`, `status` (`success`, `failure`, `unknown`), optional `outcome`, `output`, `error`, `retryable` |
| `signal` | `name`, `outcome`, optional `output` |
| `resolve` | `invocation`, `action` (`complete`, `retry`, `fail`), optional `outcome`, `output`, `error` |
| `cancel` | optional `reason` |

An **invocation reference** is `{ "node": <id>, "visit": <n> }`: the logical invocation created by visit `n` of that node. The implementation maps it to its own ID using the invoke commands it has already emitted in this trace. A reference to an invocation that was never created maps to no invocation, which lets a fixture deliver a stale result. Implementation IDs and idempotency keys are private, but an implementation MUST use one ID for every attempt of one logical invocation (invocation §3), which this mapping relies on.

**`expect` members:**

| Member | Compared how |
| --- | --- |
| `status` | Equal |
| `positions` | Array of node IDs with an active position, in ascending order. Equal. In `core` it has zero or one entry |
| `commands` | Array of portable commands in emission order. Equal |
| `diagnostics` | Every listed diagnostic is reported. More may be |
| `nodes` | For each listed node ID, its latest record `{ visit, outcome, output }` is equal |
| `result` | Equal, `null` when the run has none |
| `error` | `code` equal; `message` equal when the fixture gives one |

**Portable commands:**

| Command | Shape |
| --- | --- |
| invoke | `{ "type": "invoke", "node", "visit", "attempt", "action", "input", "params" }`. `input` and `params` are the evaluated mappings, `null` when the node declares none |
| cancel | `{ "type": "cancel", "invocation": <reference> }` |

Diagnostics are the short strings an implementation emits beside a transition, such as `signal.unmatched`. The ones the core fixtures use are listed in §5.

## 5. Codes

Validation error codes and diagnostics have the form `<area>.<problem>`: lowercase letters, digits and hyphens, with one dot. A profile prefixes its codes with its name, for example `parallel.p1`. An implementation MAY emit codes that aren't listed here; fixtures only list codes that are.

**Validation errors in `core`:**

| Code | Reported when | Spec |
| --- | --- | --- |
| `definition.language` | `language` is not `swl` | definition §2 |
| `definition.member` | An unknown top-level member | definition §2, schema |
| `definition.name` | `name` is not an ID | definition §2 |
| `start.invalid` | `start` is not an ID | definition §2 |
| `start.unknown` | `start` names no node | definition §2 |
| `nodes.empty` | `nodes` is missing or empty | definition §2 |
| `requires.unsupported` | A required profile the validator doesn't support | definition §2, §6 |
| `limits.invalid` | A limit is not a positive integer | definition §2 |
| `action.id` | An action ID is not an ID | definition §2 |
| `action.member` | An unknown member on an action contract | definition §4, schema |
| `action.effect` | `effect` is not one of the four | definition §4 |
| `action.outcomes` | `outcomes` is missing, empty, repeats a name, or uses a reserved or malformed name | definition §2, §4 |
| `action.retry` | `retry.maxAttempts` is not a positive integer | definition §4 |
| `node.id` | A node ID is not an ID | definition §2 |
| `node.kind` | An unknown node kind | definition §3 |
| `node.member` | An unknown member for the node's kind | definition §3, schema |
| `node.action` | An activity names an action with no contract | definition §3 |
| `node.signal` | An `await-signal` node has no signal name | definition §3 |
| `node.error` | A `fail` node lacks `error.code` or `error.message` | definition §3 |
| `routes.missing` | An activity or `await-signal` node has no routes | definition §3 |
| `route.outcome` | A route key is not an outcome name | definition §2 |
| `route.target` | A route names no node | definition §3 |
| `route.incomplete` | A declared business outcome has no route | definition §3 |
| `loop.exhausted-route` | `loopLimits` without an `exhausted` route, or the reverse | definition §3 |
| `loop.limit` | A loop limit on an unrouted or reserved outcome, or not a positive integer below the visit cap | definition §3 |
| `graph.unreachable` | A node with no path from `start` | definition §3 |
| `graph.no-terminal` | A node with no path to a terminal | definition §3 |

**Diagnostics used by the `core` fixtures:** `event.duplicate-start`, `event.ignored-terminal`, `signal.unmatched`, `result.stale`, `invocation.unknown`, `loop.exhausted`, `run.cancel-requested`.

**Not yet defined:** the `error.code` a run carries when it ends `failed` for an operational reason (no `failed` route, a mapping error, a limit). The core fixtures assert `status` there and leave `error` alone until execution §3 names those codes.

## 6. Schema

[`schemas/fixture.schema.json`](../schemas/fixture.schema.json) checks the structure of a fixture file. It does not check that a `definition` member is itself valid; that is the fixture's job.
