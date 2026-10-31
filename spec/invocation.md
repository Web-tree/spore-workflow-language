# Invocation and Control

**Status:** Draft normative contract. **Part:** invocation-control. **Requires:** definition for action identity; execution when driving workflows.

SWL distinguishes **the workflow caller**, **the running workflow**, **the action provider**, and **the durable host**. It does not prescribe HTTP, Temporal, NATS, WASM, or shell commands.

## 1. Three independent dimensions

1. A client can start a workflow and receive a run handle immediately, or await its result.
2. An action can return its result inline, or return an accepted operation handle and complete later.
3. A workflow can execute sequentially, suspend waiting for external input, or use a separately declared parallel profile.

A JavaScript Promise is not necessarily durable deferred completion. A provider returning `accepted` means the operation can be identified and recovered; it does not mean business success.

## 2. Abstract action lifecycle

~~~text
invoke(actionContract, invocationId, input, parameters, idempotencyKey)
    -> completed(outcome, output)
    |  accepted(operationHandle)
    |  failed(error, retryable)
    |  unknown

complete(operationHandle, completionMessageId, outcome, output)
cancel(operationHandle, cancellationRequestId)
inspect(operationHandle) -> status
~~~

These are conceptual operations; this document does not fix a network wire protocol. A host adapter MUST define authentication, authorization, serialization, deadlines, correlation and the authority that records completions.

The operation handle is **opaque**, not a portable continuation or a credential to be sent to arbitrary clients. The invoker must be able to reattach to an accepted operation after a lost acknowledgement; if it cannot, the outcome is uncertain rather than safe to repeat.

## 3. Identities and deduplication

Keep separate:
- `runId`: one execution of a pinned workflow;
- `activationId`: one visit to a node;
- `invocationId`: one logical call of an action;
- `attempt`: transport or execution delivery attempt of that invocation;
- `operationHandle`: provider-side durable operation, when applicable;
- `completionMessageId` and `requestId`: at-least-once input deduplication.

The same invocation may be redelivered with the same idempotency key. Re-visiting a node through a workflow edge creates a fresh invocation. A duplicate completion is not another business outcome. A late result from an old attempt or cancelled run must not authorize a second transition.

## 4. Control plane

Treat the following operations distinctly:

| Control | Semantics |
| --- | --- |
| `inspect` | Read current state; no side effects |
| `signal` | Asynchronous external input, acknowledged at an explicit acceptance stage |
| `update` | Tracked request/response change with validation and a defined completion receipt |
| `cancel` | Request to stop future work and attempt cancellation of in-flight work |
| `resolve` | Explicit resolution of an uncertain invocation |

A successful HTTP response can mean *received*, *durably accepted*, *applied*, or *finished*. The binding MUST make that meaning explicit. A retry after a lost response must not create unintended duplicate work.

## 5. Timeout and retry authority

Dispatch time, one execution attempt, a long-running operation and a workflow run can have different deadlines. Worker leases are not operation deadlines. Cancellation requested, acknowledged, and effect compensated are separate facts.

A particular logical invocation boundary MUST have one retry authority. Mapping an SWL policy onto Temporal's retry configuration requires exact comparison of attempt counting, retryable errors and delay behavior, not copying similarly named fields.

**Potential bindings:** Temporal Activities/Updates/Signals, Nexus operations, REST callbacks, in-process functions and Runspore workers. These are options, not mandatory dependencies. See [research](../research/prior-art.md).
