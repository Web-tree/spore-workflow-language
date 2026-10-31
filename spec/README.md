# SWL specification (working draft)

This directory is the **normative-design workspace** for the independent Spore Workflow Language. The contracts are proposals until reviewed and certified; an implementer may use them now but should not claim stable cross-runtime interoperability.

| Part | Read |
| --- | --- |
| Definition | [Definition Model](definition.md) |
| Authoring | [SWL-DOT](notation.md) |
| Runtime behavior | [Execution Semantics](execution.md) |
| Integration | [Invocation and Control](invocation.md) |
| State | [Durability and State](state.md) |
| Packaging | [Distribution](distribution.md) |
| Compatibility | [Conformance](conformance.md) |

**Conformance parts are independent subject to declared dependencies.** A tool that only reads SWL-DOT implements neither runtime semantics nor state persistence; a Temporal host can implement SWL semantics without using a Runspore store.

Language documentation is deliberately implementation-neutral. Runspore-specific migration and support notes belong in Runspore documentation. Historical dialect identifiers do not belong here.

Where draft examples and normative prose disagree, treat that as a spec issue; the implementation does not silently win. Open behavior must be identified and resolved through tests before claiming conformance.
