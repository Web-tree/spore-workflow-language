# Definition Model

**Status:** Draft normative contract. **Part:** definition. **Requires:** none for structure; actual execution also requires a declared execution profile.

## 1. Model and boundaries

A **workflow definition** is a portable directed graph of nodes with typed entry, named outcomes and explicit routes. It can be generated from SWL-DOT or another frontend. The [JSON Schema](../schemas/definition.schema.json) describes its base serialized shape.

An **action contract** describes the input/output and behavioral obligations of an operation. A **binding** supplies an implementation on a particular host and is not embedded in the definition. An action contract can be fulfilled by a Temporal Activity, in-process function, external worker, HTTP operation, or WASM component, provided the behavior matches and the host authorizes the binding.

An **activity** names an action contract, but it is not itself a command. A graph **node** is a control-flow position. Two nodes may invoke the same action with different input and parameters.

## 2. Top-level members

| Field | Requirement | Meaning |
| --- | --- | --- |
| `language` | MUST equal `swl` in the draft | Model identity, not a Runspore dialect |
| `name` | required | Workflow identifier |
| `start` | required | Existing node ID |
| `nodes` | required | Nonempty map of nodes by unique ID |
| `actions` | optional when no activities | Map of action interfaces by ID |
| `requires` | optional | Required semantic profiles; default `["core"]` when executed |
| `limits` | optional | Host-independent safety caps; default 16 visits per node, 256 activations |
| `inputSchema` | optional | JSON Schema for workflow inputs |

IDs use `[A-Za-z_][A-Za-z0-9_-]{0,63}`. Outcome names use `[a-z][a-z0-9-]{0,63}` except reserved `failed` and `exhausted`. UTF-8 presentation labels may differ from IDs. Unknown required semantics MUST be rejected before side effects.

## 3. Node kinds

| Kind | Required members | Effect |
| --- | --- | --- |
| `activity` | `action`, `routes` | Schedules the referenced action; chooses the route for its outcome |
| `await-signal` | `signal`, nonempty `routes` | Suspends until a matching signal is accepted |
| `complete` | none | Ends successfully, evaluating optional `output` mapping |
| `fail` | `error` (code, message) | Ends with a business failure |

Every outgoing `routes` member maps a named outcome to an existing target node. Nonterminal activity nodes MUST route every action-declared business outcome. Failure routing uses the reserved `failed` key; it is not an action-declared business outcome. An `exhausted` route is required exactly when `loopLimits` is present and permits controlled escape from a cycle. Terminal nodes MUST NOT have routes. Duplicate outcome keys are invalid.

`loopLimits` maps a node outcome to a positive integer: how many consecutive occurrences may route normally. The next occurrence routes `exhausted`. The workflow-wide visit cap is a safety boundary, not a business route.

Every node MUST be reachable from `start`. From every node there MUST exist a graph path to a terminal. This is *structural* reachability; a reachable terminal is not guaranteed to be taken at runtime.

## 4. Action interfaces versus bindings

Action contract fields (draft core):

| Field | Rule |
| --- | --- |
| `effect` | required: `pure`, `read-only`, `idempotent`, or `unsafe` |
| `outcomes` | required nonempty array of unique business outcomes, normally `["ok"]` |
| `inputSchema` / `outputSchemas` | optional schema contracts; output schemas keyed by outcome |
| `retry.maxAttempts` | optional positive count **including** the initial delivery attempt; default 1 |
| `capabilities` | optional required features; MUST be checked against the host before execution |

Effects are obligations, not enforceable properties of an arbitrary executable. `unsafe` means the host must not automatically repeat an invocation with unknown result. Another host implementation must document and meet the same observable contract; using identical JSON schemas alone is insufficient.

An implementation binding is separate deployment configuration, for example:

~~~json
{
  "bindings": {
    "reserve": {
      "provider": "temporal-activity",
      "type": "reserveCapacity"
    }
  }
}
~~~

This **illustrative binding** is not a required SWL protocol. Provider-specific credentials, capabilities and authorization remain host concerns.

## 5. Mapping and data

The mandatory minimal expression profile supports JSON values plus:

- `{"$get":["input","task"]}`: copy a value at a path through the evaluation context;
- `{"$literal":{"$get":["input","task"]}}`: return nested data without evaluating it.

A path begins with `input`, `nodes`, `from` or `run`. Path segments are object keys or nonnegative array indexes. Missing paths are errors, not silently null. The context contains initial input, latest result per node (`{outcome,output,visit}`), the incoming route (`from`, or null at start), and an immutable run identity.

There is no implicit JavaScript evaluation, truthiness or mutable global context. Conditionals, joins, JSON Logic and further operators belong to explicit optional expression profiles with separate fixtures. JSON Schema dialect and numeric-domain compatibility must be declared rather than inferred.

## 6. Portability

A definition can be validated, inspected and rendered without an action implementation. To execute, a host MUST resolve the required action interfaces to authorized bindings satisfying the declared capabilities, and MUST reject unsupported semantic profiles before scheduling effects.

Graphviz appearance (`label`, `shape`, colors) is **non-semantic** and never part of the normalized execution model. Two presentations of the same graph may produce the same normalized definition.
