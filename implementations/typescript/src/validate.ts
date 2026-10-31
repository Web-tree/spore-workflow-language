import type { ActionContract, Definition, Node } from "./types";

const IDENT = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;
const OUTCOME = /^[a-z][a-z0-9-]{0,63}$/;
const EFFECTS = new Set(["pure", "read-only", "idempotent", "unsafe"]);
const KINDS = new Set(["activity", "await-signal", "complete", "fail"]);
export const CORE_PROFILE = "core";

/** Structural + cross-reference validator of the current small sequential draft. */
export function validateDefinition(d: Definition, supported: readonly string[] = [CORE_PROFILE]): string[] {
  const errors: string[] = [];
  if (!d || d.language !== "swl") return ["language must be swl"];
  if (!IDENT.test(d.name)) errors.push("invalid workflow name");
  if (!IDENT.test(d.start)) errors.push("invalid start ID");
  if (!d.nodes || typeof d.nodes !== "object" || Object.keys(d.nodes).length === 0) return [...errors, "nodes required"];
  if (!(d.start in d.nodes)) errors.push("start node not found: " + d.start);
  const actions = d.actions ?? {};
  const requirements = d.requires ?? ["core"];
  for (const r of requirements) if (!supported.includes(r)) errors.push("unsupported required profile: " + r);
  const maxVisits = d.limits?.maxVisitsPerNode ?? 16;
  const maxActivations = d.limits?.maxActivations ?? 256;
  if (!Number.isInteger(maxVisits) || maxVisits < 1) errors.push("invalid maxVisitsPerNode");
  if (!Number.isInteger(maxActivations) || maxActivations < 1) errors.push("invalid maxActivations");

  for (const [id, action] of Object.entries(actions)) {
    if (!IDENT.test(id)) errors.push("invalid action ID: " + id);
    const a = action as ActionContract;
    if (!EFFECTS.has(a.effect)) errors.push("invalid action effect: " + id);
    if (!Array.isArray(a.outcomes) || a.outcomes.length === 0 || a.outcomes.some(o => !OUTCOME.test(o) || o === "failed" || o === "exhausted") || new Set(a.outcomes).size !== a.outcomes.length) {
      errors.push("invalid action outcomes: " + id);
    }
    const n = a.retry?.maxAttempts ?? 1;
    if (!Number.isInteger(n) || n < 1) errors.push("invalid retry attempts: " + id);
  }
  for (const [id, node] of Object.entries(d.nodes)) {
    if (!IDENT.test(id)) errors.push("invalid node ID: " + id);
    if (!node || !KINDS.has(node.kind)) { errors.push("invalid node kind: " + id); continue; }
    if (node.kind === "activity" || node.kind === "await-signal") {
      const routes = node.routes;
      if (!routes || Object.keys(routes).length === 0) { errors.push("missing routes: " + id); continue; }
      for (const [outcome, target] of Object.entries(routes)) {
        if (!OUTCOME.test(outcome)) errors.push("invalid route outcome: " + id + "." + outcome);
        if (!(target in d.nodes)) errors.push("unknown route target: " + id + " -> " + target);
      }
      if (node.kind === "activity") {
        const action = actions[node.action];
        if (!action) errors.push("missing action binding contract: " + id + " -> " + node.action);
        else for (const o of action.outcomes) if (!(o in routes)) errors.push("missing outcome route: " + id + "." + o);
      } else if (!node.signal) errors.push("missing signal: " + id);
      const limits = node.loopLimits;
      if (limits) {
        if (!Object.keys(limits).length || !("exhausted" in routes)) errors.push("loopLimits require exhausted route: " + id);
        for (const [outcome, limit] of Object.entries(limits)) {
          if (outcome === "exhausted" || !(outcome in routes) || !Number.isInteger(limit) || limit < 1 || limit >= maxVisits) errors.push("invalid loop limit: " + id + "." + outcome);
        }
      } else if ("exhausted" in routes) errors.push("exhausted route without loopLimits: " + id);
    } else if (node.kind === "fail" && (!node.error?.code || !node.error.message)) {
      errors.push("fail requires code and message: " + id);
    }
  }

  if (d.start in d.nodes) {
    const seen = new Set<string>();
    const visit = (id: string): void => {
      if (seen.has(id) || !d.nodes[id]) return;
      seen.add(id);
      const n = d.nodes[id];
      if ("routes" in n) for (const target of Object.values(n.routes)) visit(target);
    };
    visit(d.start);
    for (const id of Object.keys(d.nodes)) if (!seen.has(id)) errors.push("unreachable node: " + id);
    const ends = new Set(Object.entries(d.nodes).filter(([,n])=>n.kind === "complete" || n.kind === "fail").map(([id])=>id));
    const canFinish = new Set(ends);
    let changed = true;
    while (changed) {
      changed = false;
      for (const [id, n] of Object.entries(d.nodes)) {
        if (!canFinish.has(id) && "routes" in n && Object.values(n.routes).some(t => canFinish.has(t))) { canFinish.add(id); changed = true; }
      }
    }
    for (const id of Object.keys(d.nodes)) if (!canFinish.has(id)) errors.push("no path to terminal: " + id);
  }
  return errors;
}
