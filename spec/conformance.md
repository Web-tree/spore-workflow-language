# Conformance, Compatibility and Versioning

**Status:** Draft conformance policy, not a published certification program.

## 1. Claim exactly what was implemented

A software project SHOULD publish a machine-readable manifest naming:

- SWL specification release or draft commit;
- implemented parts (definition, source-notation, execution, invocation-control, durable-state, store-provider, state-interchange, distribution);
- supported **feature profiles** and expression/schema dialects;
- limits (size, depth, visits, timers, supported action kinds);
- tested conformance fixture revision.

No implementation may imply it supports every SWL feature just because it parses SWL-DOT.

## 2. Behavioral boundaries

| Claim | Required evidence |
| --- | --- |
| **Source** | Parse and normalize valid and invalid examples; ensure presentation does not alter semantics |
| **Definition** | Schema and graph invariants, action contracts and capability validation |
| **Execution** | Equivalent accepted event traces yield matching observable commands, routes, states and result codes |
| **Invocation** | Inline/deferred, duplication, retry authority, cancellation and correlation |
| **Durable behavior** | Crash, fencing, deduplication, atomicity and restart tests |
| **Store provider** | Multi-coordinator concurrency and lost-acknowledgement tests |
| **State interchange** | Verified export/import with source fencing at supported boundaries |

Equivalent observable traces do **not** mean private database bytes or Temporal event-history records must match those of Runspore. A separately declared byte-exact canonical encoding may impose stronger constraints.

## 3. Feature profiles (candidates)

`core` is sequential execution with activity, await-signal, complete/fail, named routes, explicit failures and basic mapping. Other independently declared capabilities may include:

- `buffered-signals` and `timers`;
- `deferred-actions` and `tracked-updates`;
- `parallel`, `subworkflows` and `compensation`;
- `expressions-jsonlogic`, `state-export` and `store-provider`.

These names are **draft design targets**, not claims that all corresponding execution algorithms have been specified. A feature name without normative rules and positive/negative fixtures is not conformant.

## 4. Verification

The first official suite should include valid/invalid definition fixtures, DOT parse cases, trace fixtures, rejected feature declarations and action-contract errors, plus recovery fault injection for stateful hosts. Tests SHOULD cover ambiguous edge cases: explicit vs default outcomes; missing vs null values; unknown effect result; stale completion; retries after crashes; timers; cancellation races; safe migration fences.

A non-Rust implementation must derive expected behavior from the published spec and fixtures, rather than call Runspore's reducer and claim independence.

## 5. Changes and authority

Spec releases are immutable. Editorial errata that affect expected behavior require a test. New required fields, changed routing, value normalization, identifiers or canonical encodings are breaking changes unless a separately negotiated feature/release gate permits them.

**The standard wins over any one implementation.** When code and normative text disagree, open an issue and a conformance fixture; do not silently redefine SWL from implementation details.
