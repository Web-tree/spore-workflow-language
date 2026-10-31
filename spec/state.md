# Durability, Storage and State Interchange

**Status:** Draft normative and proposed optional profiles. **Part:** state. **Requires:** execution and invocation for durable action-bearing engines.

The state specification has **three separate contracts**. An implementation may claim durable behavior without implementing the optional storage-provider API or cross-host resume exchange.

## 1. Durable behavior profile

After an acknowledged durable event, an implementation MUST preserve its accepted order, deduplication identity, authorized work intents and subsequent logical state across the claimed failure model. A host must not dispatch an effect whose intent cannot be recovered after a crash.

A workflow execution MUST pin its definition, required semantic profiles and bound action interfaces (or a reproducible immutable resolution of them). A new deployment must not silently reinterpret an already-running workflow.

External exactly-once execution is not guaranteed; use stable logical invocation IDs, idempotency or reconciliation. An unprovable effect result is represented as unknown and resolved explicitly where required.

## 2. Optional store-provider contract

A storage implementation provides semantic operations, not only key/value methods.

| Operation | Required behavior |
| --- | --- |
| `createRun` | Idempotent by scoped request ID and body digest |
| `appendEvent` | Atomically accept one ordered event or return its receipt |
| `commitTransition` | Compare expected revision and atomically persist state, consumed event and work intents |
| `claimWork` | Acquire an owner and fencing token with an expiry |
| `completeWork` | Reject stale owners/tokens and deduplicate recorded completion |
| `readRun` / `listDueWork` | Consistent reads and recovery of due work |

Repeating a request ID with identical content returns the same receipt; reusing it with conflicting content is an error. Fenced claims cannot be resurrected by a late heartbeat. The storage implementation must define failure/recovery outcomes for a lost response after a successful commit.

The contract permits SQL, log-based storage or another safe implementation. It does not prescribe SQLite tables, a vendor, or a host process count.

## 3. State inspection (portable view)

An inspector may read: run ID, definition identity, execution status, active position(s), latest node outcomes, pending signals, outstanding operation summaries, blockers and recent accepted events. Inspection does not imply a new runtime can resume execution.

A state view SHOULD be safe to share without embedding credentials, capability grants, secret environment variables, native handles or plaintext sensitive action inputs.

## 4. Optional resumable interchange

A resumable export must describe **all semantic state** necessary at a declared supported boundary: pinned definition/semantics/bindings, run input and context, positions, activation counters, retry/loop counters, accepted messages and deduplication receipts, timers/deadlines, outstanding operations and extension-specific state.

Initial interoperability SHOULD target **quiescent boundaries** only: the source is fenced before the destination is activated. An in-flight operation needs a transferable, authenticated handle and an explicitly specified handoff profile.

A JSON snapshot of Temporal internals is not a portable SWL continuation. A matching normalized definition alone is not enough to migrate running executions between hosts.

## 5. Mandatory failure tests for claimed durable implementations

- Crash between event acceptance and transition commit.
- Crash after committed intent but before dispatch.
- External effect succeeds but its acknowledgement is lost.
- Duplicate event, duplicate completion, stale attempt and conflicting request body.
- Lease expiry racing with completion; late heartbeat must fail.
- Concurrent coordinator commits at the same revision.
- Cancellation racing with deferred completion.
- Recovery after host restart with immutable pinned definition.

A passing in-memory reducer test does not establish durable-host conformance.
