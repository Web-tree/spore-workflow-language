# Governance

**Stewardship:** WebTree → Runspore → Spore Workflow Language.

This repository is the independent, public source of normative SWL text, schemas and conformance fixtures. Runspore is a reference implementation and a steward, **not** the authority that silently determines the language's behavior. Independent implementations may use any licensed technology.

## How the draft evolves

1. Open an issue with a motivating workflow and why existing parts are insufficient.
2. Propose an RFC defining scope, normative behavior, compatibility, security implications, and new positive/negative test cases.
3. Discuss interface and semantics before adding syntax or implementation-specific bindings.
4. Change the specification and conformance tests together.
5. Release immutable tagged snapshots after independent implementation evidence is available.

Use MUST/SHOULD/MAY only when a behavior is intended to be testable. Mark unresolved choices explicitly. Presentation properties must not acquire hidden execution meaning.

Public spec revisions are published here. Websites (including Runspore's) display a **pinned** revision of the same source and provide an edit link back to this repository; they do not fork the specification.

## Security and neutrality

A workflow definition cannot authorize itself to invoke host capabilities, payments, secrets or privileged commands. Bindings and access control belong to the host. Generic SWL remains independent of AI frameworks and product-specific business rules.

Changes should not embed private WebTree Hub or MakeLocal material in the public standard without authorization.
