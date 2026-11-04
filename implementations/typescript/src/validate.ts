import type { ActionContract, Definition } from "./types";

/** A validation error: a stable code (spec/fixtures.md §5) and a message for people. */
export interface ValidationError { code: string; message: string }

const IDENT = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;
const OUTCOME = /^[a-z][a-z0-9-]{0,63}$/;
const EFFECTS = new Set(["pure", "read-only", "idempotent", "unsafe"]);
const KINDS = new Set(["activity", "await-signal", "complete", "fail"]);
const TOP_MEMBERS = new Set(["language", "name", "start", "nodes", "actions", "requires", "limits", "inputSchema"]);
const ACTION_MEMBERS = new Set(["effect", "outcomes", "retry", "inputSchema", "outputSchemas", "capabilities"]);
const NODE_MEMBERS: Record<string, Set<string>> = {
  activity: new Set(["kind", "action", "routes", "input", "params", "loopLimits"]),
  "await-signal": new Set(["kind", "signal", "routes", "loopLimits"]),
  complete: new Set(["kind", "output"]),
  fail: new Set(["kind", "error"]),
};
export const CORE_PROFILE = "core";

const isId = (v: unknown): v is string => typeof v === "string" && IDENT.test(v);

/** Structural + cross-reference validator of the current small sequential draft. */
export function validateDefinition(d: Definition, supported: readonly string[] = [CORE_PROFILE]): ValidationError[] {
  const errors: ValidationError[] = [];
  const err = (code: string, message: string): void => { errors.push({ code, message }); };
  if (!d || typeof d !== "object" || d.language !== "swl") return [{ code: "definition.language", message: "language must be swl" }];
  for (const k of Object.keys(d)) if (!TOP_MEMBERS.has(k)) err("definition.member", "unknown member: " + k);
  if (!isId(d.name)) err("definition.name", "invalid workflow name");
  if (!isId(d.start)) err("start.invalid", "invalid start ID");
  if (!d.nodes || typeof d.nodes !== "object" || Object.keys(d.nodes).length === 0) { err("nodes.empty", "nodes required"); return errors; }
  if (!(d.start in d.nodes)) err("start.unknown", "start node not found: " + d.start);
  const actions = d.actions ?? {};
  const requirements = d.requires ?? [CORE_PROFILE];
  for (const r of requirements) if (!supported.includes(r)) err("requires.unsupported", "unsupported required profile: " + r);
  const maxVisits = d.limits?.maxVisitsPerNode ?? 16;
  const maxActivations = d.limits?.maxActivations ?? 256;
  if (!Number.isInteger(maxVisits) || maxVisits < 1) err("limits.invalid", "invalid maxVisitsPerNode");
  if (!Number.isInteger(maxActivations) || maxActivations < 1) err("limits.invalid", "invalid maxActivations");

  for (const [id, action] of Object.entries(actions)) {
    if (!IDENT.test(id)) err("action.id", "invalid action ID: " + id);
    if (!action || typeof action !== "object") { err("action.member", "action is not an object: " + id); continue; }
    const a = action as ActionContract;
    for (const k of Object.keys(a)) if (!ACTION_MEMBERS.has(k)) err("action.member", "unknown action member: " + id + "." + k);
    if (!EFFECTS.has(a.effect)) err("action.effect", "invalid action effect: " + id);
    if (!Array.isArray(a.outcomes) || a.outcomes.length === 0 || a.outcomes.some(o => !OUTCOME.test(o) || o === "failed" || o === "exhausted") || new Set(a.outcomes).size !== a.outcomes.length) {
      err("action.outcomes", "invalid action outcomes: " + id);
    }
    const n = a.retry?.maxAttempts ?? 1;
    if (!Number.isInteger(n) || n < 1) err("action.retry", "invalid retry attempts: " + id);
  }
  for (const [id, node] of Object.entries(d.nodes)) {
    if (!IDENT.test(id)) err("node.id", "invalid node ID: " + id);
    if (!node || !KINDS.has(node.kind)) { err("node.kind", "invalid node kind: " + id); continue; }
    for (const k of Object.keys(node)) if (!NODE_MEMBERS[node.kind].has(k)) err("node.member", "unknown member for " + node.kind + ": " + id + "." + k);
    if (node.kind === "activity" || node.kind === "await-signal") {
      const routes = node.routes;
      if (!routes || typeof routes !== "object" || Object.keys(routes).length === 0) { err("routes.missing", "missing routes: " + id); continue; }
      for (const [outcome, target] of Object.entries(routes)) {
        if (!OUTCOME.test(outcome)) err("route.outcome", "invalid route outcome: " + id + "." + outcome);
        if (!(target in d.nodes)) err("route.target", "unknown route target: " + id + " -> " + target);
      }
      if (node.kind === "activity") {
        const action = actions[node.action];
        if (!action) err("node.action", "missing action contract: " + id + " -> " + node.action);
        else if (Array.isArray(action.outcomes)) for (const o of action.outcomes) if (!(o in routes)) err("route.incomplete", "missing outcome route: " + id + "." + o);
      } else if (!node.signal) err("node.signal", "missing signal: " + id);
      const limits = node.loopLimits;
      if (limits) {
        if (!Object.keys(limits).length || !("exhausted" in routes)) err("loop.exhausted-route", "loopLimits require an exhausted route: " + id);
        for (const [outcome, limit] of Object.entries(limits)) {
          if (outcome === "exhausted" || !(outcome in routes) || !Number.isInteger(limit) || limit < 1 || limit >= maxVisits) err("loop.limit", "invalid loop limit: " + id + "." + outcome);
        }
      } else if ("exhausted" in routes) err("loop.exhausted-route", "exhausted route without loopLimits: " + id);
    } else if (node.kind === "fail" && (!node.error?.code || !node.error.message)) {
      err("node.error", "fail requires code and message: " + id);
    }
  }

  if (d.start in d.nodes) {
    const seen = new Set<string>();
    const visit = (id: string): void => {
      if (seen.has(id) || !d.nodes[id]) return;
      seen.add(id);
      const n = d.nodes[id];
      if ("routes" in n && n.routes) for (const target of Object.values(n.routes)) visit(target);
    };
    visit(d.start);
    for (const id of Object.keys(d.nodes)) if (!seen.has(id)) err("graph.unreachable", "unreachable node: " + id);
    const ends = new Set(Object.entries(d.nodes).filter(([, n]) => n.kind === "complete" || n.kind === "fail").map(([id]) => id));
    const canFinish = new Set(ends);
    let changed = true;
    while (changed) {
      changed = false;
      for (const [id, n] of Object.entries(d.nodes)) {
        if (!canFinish.has(id) && "routes" in n && n.routes && Object.values(n.routes).some(t => canFinish.has(t))) { canFinish.add(id); changed = true; }
      }
    }
    for (const id of Object.keys(d.nodes)) if (!canFinish.has(id)) err("graph.no-terminal", "no path to terminal: " + id);
  }
  return errors;
}
