# Distribution and Artifacts

**Status:** Draft optional contract. **Part:** distribution. **Requires:** definition; optionally source-notation.

Distribution is not required to parse or run a definition already provided by a trusted host.

A package contains an immutable normalized definition and an explicitly declared set of assets (instructions, schemas and executables) that a chosen binding needs. A manifest records language release, required feature profiles, content digests, resource boundaries and declared dependencies. Undeclared adjacent files do not join a package implicitly.

A portable package MUST NOT require the Runspore CLI, Rust toolchain, WASM loader, or SQLite. A particular host MAY offer WASM packaging, container packaging or another format as a separate distribution profile.

A compiler MUST reject path traversal, absolute paths, missing required assets, digest mismatches and unsupported required profiles before an effect is scheduled. A signed package is not automatically authorized to invoke a capability.

Canonical semantic identity should be computed from a declared deterministic serialization of the normalized definition. Visual layout/presentation changes must not silently change runtime decisions. Source provenance or artifact digests may independently change when source files or packaging encoders change.

**Open design point:** the first stable canonical encoding and digest domain. The public draft deliberately does not claim that any existing Runspore-specific binary/digest is the SWL interchange format. Finalize with fixtures and a second independent implementation.
