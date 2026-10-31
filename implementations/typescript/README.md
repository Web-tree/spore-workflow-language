# Independent TypeScript/Bun draft implementation

An intentionally small, **independently implemented** interpreter for the SWL sequential core. It is not a wrapper around Runspore Rust/WASM and is **not** yet certified for durable host or broad SWL-DOT compatibility.

~~~sh
cd implementations/typescript
bun install
bun test
bun run typecheck
~~~

Public APIs: `validateDefinition`, `compileDot`, and the pure `transition`. The reducer performs no external effects, uses no clock or I/O, and emits invocation intents. The demonstration host must deliver these commands itself. The included parser accepts the documented simple subset of SWL-DOT, not every Graphviz construct; unsupported input is rejected rather than guessed.

Missing features before a stable execution conformance claim include a complete DOT grammar/round-trip, full JSON Schema and expression evaluation, semantic profiles beyond the sequential core, canonical cross-language encoding, atomic durable-host integration and adversarial fault testing. A Temporal adapter must be implemented and tested separately.
