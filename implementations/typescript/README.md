# Independent TypeScript/Bun draft implementation

An intentionally small, **independently implemented** interpreter library for the draft SWL `core` and [`parallel`](../../spec/parallel.md) profiles. It provides a validator, DOT compiler and pure reducer for implementers exploring the specification and its fixtures.

For installing and using the Runspore CLI, start with the [Runspore user documentation](https://runspore.com/docs). This library has its own implementation and conformance scope, separate from Runspore's Rust/WASM runtime.

## Run the checks

With Bun installed, run these commands from the root of this repository:

~~~sh
cd implementations/typescript
bun install
bun test
bun run typecheck
~~~

The fixture runner reads the repository's [definition, DOT and trace fixtures](../../fixtures/README.md). Its claimed profiles are exported as `CLAIMED_PROFILES` in [`src/validate.ts`](src/validate.ts). Compare results against the exact specification and fixture revision used for a run.

## What the library provides

The main APIs are `validateDefinition`, `compileDot`, and the pure `transition`, exported from [`src/index.ts`](src/index.ts). The reducer performs no external effects, uses no clock or I/O, and emits invocation or cancellation intents. A host must execute those commands, deliver result and signal events, and persist state if durability is required.

The included parser accepts the supported [SWL-DOT](../../spec/notation.md) syntax, including parallel edge groups. Unsupported constructs are rejected. The `parallel` implementation includes splits, gathers, optional arrivals and cancellation of unfinished branches under the draft rules.

## Scope and limits

The implementation remains a draft. Full JSON Schema and expression evaluation, lossless DOT round-tripping, canonical cross-language encoding, atomic durable-host integration and adversarial fault testing remain outside its implemented guarantees. Profiles beyond `core` and `parallel` need separate implementation and tests; a Temporal adapter also needs to be implemented and tested separately.

Passing the included fixtures establishes evidence for this library at the tested revision. It does not certify durable execution or imply that the Runspore CLI accepts SWL definitions. See the [conformance policy](../../spec/conformance.md) for how to state a compatibility claim.
