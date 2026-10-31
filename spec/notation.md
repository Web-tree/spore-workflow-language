# SWL-DOT: graph authoring notation

**Status:** Draft normative syntax binding. **Part:** source-notation. **Requires:** definition.

SWL-DOT is a constrained **subset of Graphviz DOT syntax**, with separately standardized workflow meaning. It is neither arbitrary DOT nor an extension to Graphviz's grammar. Graphviz need not be installed for a parser or runtime.

## 1. Source folder and compilation

A source workflow directory may contain `workflow.dot` (topology) and `settings.json` (action interfaces, mappings, limits, node configuration). A compiler combines them into the normalized [Definition Model](definition.md). A runtime MAY accept the normalized definition directly, without ever parsing DOT.

The graph's name and graph-specific fields `start`, `kind` and `on` are authoritative in the DOT notation; `settings.json` MUST NOT silently override them. The optional settings file cannot define executable script or native-function bindings as if they were portable action interfaces; host bindings remain separate. Additional referenced schema files are explicitly declared rather than discovered by globbing.

## 2. Grammar profile

Accepted constructs are: one named `digraph`, graph assignments `start = "step";`, node declarations `step [kind="activity"];`, directed edges `a -> b [on="ok"];`, edge chains `a -> b -> c;`, quoted and simple bare IDs, and DOT line/block comments.

The default node kind is `activity`. The default edge outcome is `ok`. An `await-signal` node uses named events (often `received` or an explicit business outcome), and terminal nodes use `complete` or `fail`. Edges route named outcomes—not evaluation of an arbitrary string label.

Source profiles MUST reject ambiguous unsupported DOT constructs such as undirected graphs, ports and subgraphs, rather than guess their control-flow meaning. A conformant extended frontend may accept more DOT syntax only when its normalization is unambiguous and it advertises that extension.

~~~dot
digraph "review" {
  start = "build";
  build [kind="activity", label="Build"];
  approve [kind="await-signal", label="Approval"];
  done [kind="complete"];
  denied [kind="fail"];

  build -> approve [on="ok"];
  build -> denied [on="failed"];
  approve -> done [on="approved"];
  approve -> denied [on="rejected"];
}
~~~

The `label` values above have no execution meaning. A tool must not infer an action from the visual `shape` or treat a drawn caption as a route. A renderer that ignores SWL attributes may show the graph but does not thereby validate the workflow.

## 3. Attributes, defaults and errors

| Location | Semantic attribute | Meaning |
| --- | --- | --- |
| graph | `start` | Required node ID |
| node | `kind` | `activity` (default), `await-signal`, `complete`, `fail` |
| edge | `on` | Named outcome; `ok` if omitted |

Graphviz-only rendering attributes may be accepted from an explicit allowlist and discarded during semantic normalization. Unknown **semantic** attributes, conflicting repeated declarations, unknown target nodes, duplicate outgoing outcomes and unsupported required extensions MUST be errors. Namespaced presentation extensions may be retained without becoming control-flow rules.

The initial notation profile intentionally does **not** require a legacy Runspore `dialect` marker. Existing Runspore workflows need an explicit compatibility/migration adapter; claiming that an unmodified Runspore parser accepts SWL-DOT is incorrect.

## 4. Source mapping and round-trip tools

A parser SHOULD expose source locations and comments to editors separately from the semantic definition. Re-rendering should preserve meaning; a lossless editor additionally preserves authorship details and unrelated presentation attributes.

The normalized JSON model is the runtime interchange format. DOT layout hints MUST NOT affect canonical identities or execution decisions.
