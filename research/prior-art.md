# Standards review and prior art

This document is **informative**. SWL is general-purpose and intentionally does not require AI agents, a specific programming language, a database, or a transport.

| Reference | Useful idea | Boundary for SWL |
| --- | --- | --- |
| [StrongDM Attractor](https://github.com/strongdm/attractor/blob/main/attractor-spec.md) | Explicit execution algorithm, handler contracts, routing order, checkpoint and acceptance rules | Do not use visual node shapes/edge labels to select execution; AI-specific configuration stays in optional providers |
| [W3C SCXML](https://www.w3.org/TR/scxml/) | Event ordering and run-to-completion behavior | Hierarchical statecharts and the full SCXML data model are not core requirements |
| [Open Workflow](https://github.com/open-workflow-specification/specification/blob/main/dsl-reference.md) | Typed task definitions, external integrations, event wait, workflow lifecycle | Separate task interface from implementation and detached work from awaited deferred completion |
| [Amazon States Language](https://states-language.net/spec.html) | Retry/Catch precedence, timeout scopes, parallel routing | Explicit attempt counting, result/error categories, failure semantics |
| [Common Workflow Language](https://www.commonwl.org/v1.2/Workflow.html) | Mandatory requirements versus optional hints, abstract process definitions | Explicit profiles and capability rejection rather than hidden implementation assumptions |
| [Nexus RPC](https://github.com/nexus-rpc/api/blob/main/SPEC.md) | Inline results, long-running operation handles, callbacks, cancellation | Candidate transport binding, not a mandated protocol |
| [Temporal](https://docs.temporal.io/workflow-definition) | Durable history, deterministic replay and language SDKs | SWL may run atop Temporal without a second persistent state authority |

## Specifically valuable distinctions

- Attractor demonstrates how much ambiguity is removed by normative state-transition algorithms. SWL should borrow that rigor, not its AI-oriented shape semantics.
- SCXML demonstrates the importance of specifying accepted order, internal progress and event consumption rather than saying only "wait for signal".
- Open Workflow separates invocation and event waiting. SWL must not confuse an operation-accepted receipt with completed business work.
- AWS Step Functions and Temporal do not count retries identically under similarly named fields; an adapter must test semantics rather than copy names.
- CWL's requirements/hints distinction is a good model for supporting subsets of SWL.
- Nexus is promising for async operation boundaries, especially where Temporal itself remains the durable orchestrator; confirm actual SDK/server topology before selecting a concrete binding.
- Separately test behavior under different engines; schema equality is insufficient to demonstrate equivalent side effects or safe state migration.

### Future investigation

Publish detailed comparison cases on event races, parallel joins, compensations, child workflow identities, safe migration, and expression semantics. Add interoperable traces instead of increasing the mandatory core without evidence.
