import type { ActionContract, Arrivals, Command, Decision, Definition, Event, From, Json, Position, RunState, SplitInstance } from "./types";
import { validateDefinition } from "./validate";
import { analyze, type Split } from "./parallel";

/** The evaluation context of a mapping (definition §5; `arrivals` only at a gather, parallel §2). */
export interface Scope { input: Json; nodes: RunState["nodes"]; from: From | null; runId: string; arrivals?: Arrivals }

/** Only portable, deterministic $get / $literal operators are in this small draft core. */
export function evaluate(value: Json | undefined, scope: Scope): Json {
  if (value === undefined) return null;
  if (Array.isArray(value)) return value.map(item => evaluate(item, scope));
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value);
    if (keys.length === 1 && keys[0] === "$literal") return structuredClone(value.$literal);
    if (keys.length === 1 && keys[0] === "$get") {
      const steps = value.$get;
      if (!Array.isArray(steps) || steps.length < 1 || steps.some(s => typeof s !== "string" && (!Number.isInteger(s) || (s as number) < 0))) throw new Error("invalid $get path");
      const context: Record<string, unknown> = { input: scope.input, nodes: scope.nodes, from: scope.from, run: { id: scope.runId } };
      if (scope.arrivals) context.arrivals = scope.arrivals;
      let cursor: unknown = context;
      for (const s of steps) {
        if (cursor === null || typeof cursor !== "object" || !Object.hasOwn(cursor, s as string)) throw new Error("missing mapping path: " + JSON.stringify(steps));
        cursor = (cursor as Record<string, unknown>)[s as string];
      }
      return structuredClone(cursor) as Json;
    }
    if (keys.some(k => k.startsWith("$"))) throw new Error("unknown mapping operator");
    return Object.fromEntries(keys.map(k => [k, evaluate(value[k], scope)]));
  }
  return value;
}

const TERMINAL = new Set(["completed", "failed", "cancelled"]);
const RESERVED = new Set(["failed", "exhausted", "unmet"]);
type End = NonNullable<RunState["pending"]>;
type Failure = { code: string; message: string };
interface Ctx { d: Definition; s: RunState; splits: Split[]; commands: Command[]; diagnostics: string[] }

const action = (c: Ctx, nodeId: string): ActionContract | undefined => {
  const n = c.d.nodes[nodeId];
  return n.kind === "activity" ? c.d.actions?.[n.action] : undefined;
};
const isUnsafe = (c: Ctx, p: Position): boolean => action(c, p.node)?.effect === "unsafe";
const splitOf = (c: Ctx, inst: SplitInstance): Split => c.splits.find(x => x.node === inst.node && x.outcome === inst.outcome) as Split;
/** Whether a position lies inside the split instance `key`, directly or through nested splits. */
function belongs(s: RunState, key: string | null, target: string): boolean {
  for (let k = key; k; k = s.splits[k]?.parent ?? null) if (k === target) return true;
  return false;
}

/** The run's status follows from its positions (parallel §4.10). */
function refresh(s: RunState): void {
  if (TERMINAL.has(s.status)) return;
  if (s.positions.some(p => p.parked)) s.status = "needs-intervention";
  else if (s.pending) s.status = "stopping";
  else if (s.positions.some(p => p.invocation)) s.status = "running";
  else s.status = "waiting";
}
function finish(s: RunState, end: End): void {
  s.status = end.status; s.positions = []; s.splits = {}; s.result = null;
  delete s.pending;
  if (end.error) s.error = end.error; else delete s.error;
}
/** Ends the run, or holds it `stopping` while an unsafe invocation is still out (execution §5). */
function stop(c: Ctx, end: End): void {
  const keep: Position[] = [];
  for (const p of c.s.positions) {
    if (!p.invocation) continue;
    c.commands.push({ type: "cancel", invocationId: p.invocation.id });
    if (isUnsafe(c, p)) keep.push(p);
  }
  if (!keep.length) { finish(c.s, end); return; }
  c.s.positions = keep; c.s.splits = {}; c.s.pending = end;
  refresh(c.s);
}
/** During `stopping`, a known result of an unsafe invocation is recorded and routes nowhere. */
function settle(c: Ctx, p: Position, record: RunState["nodes"][string]): void {
  c.s.nodes[p.node] = record;
  c.s.positions = c.s.positions.filter(x => x !== p);
  if (!c.s.positions.length) finish(c.s, c.s.pending as End); else refresh(c.s);
}

function invoke(c: Ctx, p: Position, attempt: number, input: Json, params: Json): void {
  const n = c.d.nodes[p.node];
  if (n.kind !== "activity") throw new Error("invoke on non-activity");
  const id = c.s.runId + ":" + p.node + ":" + c.s.visits[p.node];
  p.invocation = { id, nodeId: p.node, attempt, input, params }; p.parked = false;
  c.commands.push({ type: "invoke", invocationId: id, nodeId: p.node, action: n.action, attempt, idempotencyKey: id, input, params });
}
/** Enters a node at a position. Returns the failure that ends the run, if any. */
function enter(c: Ctx, p: Position, nodeId: string, from: From | null, arrivals?: Arrivals): Failure | null {
  const { d, s } = c;
  const node = d.nodes[nodeId];
  if (!node) return { code: "workflow.missing-node", message: nodeId };
  const visit = (s.visits[nodeId] ?? 0) + 1;
  if (visit > (d.limits?.maxVisitsPerNode ?? 16) || s.activations + 1 > (d.limits?.maxActivations ?? 256)) return { code: "workflow.limit-exceeded", message: nodeId };
  s.visits[nodeId] = visit; s.activations++;
  p.node = nodeId; p.from = from; p.invocation = null; p.parked = false;
  if (arrivals) s.nodes[nodeId] = { visit, arrivals };
  const scope: Scope = { input: s.input, nodes: s.nodes, from, runId: s.runId, arrivals };
  if (node.kind === "activity") {
    let input: Json, params: Json;
    try { input = evaluate(node.input, scope); params = evaluate(node.params, scope); }
    catch (e) { return { code: "mapping.invalid", message: String(e) }; }
    invoke(c, p, 1, input, params);
  } else if (node.kind === "complete") {
    try { s.result = evaluate(node.output, scope); } catch (e) { return { code: "mapping.invalid", message: String(e) }; }
    s.status = "completed"; s.positions = []; s.splits = {};
  } else if (node.kind === "fail") return node.error;
  else if (node.kind === "drop") return { code: "workflow.unroutable", message: nodeId };
  return null;
}
/** Takes the route `chosen` out of `source` at position p: a split, a drop, an arrival, or an ordinary entry. */
function follow(c: Ctx, p: Position, source: string, chosen: string, from: From): void {
  const { d, s } = c;
  const node = d.nodes[source];
  const target = "routes" in node && Object.hasOwn(node.routes, chosen) ? node.routes[chosen] : undefined;
  if (!target) { stop(c, { status: "failed", error: { code: "workflow.no-route", message: source + "." + chosen } }); return; }
  if (Array.isArray(target)) { split(c, p, source, chosen, from, target); return; }
  const inst = p.split ? s.splits[p.split] : undefined;
  if (inst && target === inst.gather) { finishBranch(c, p, { outcome: from.outcome, output: from.output }); return; }
  if (inst && d.nodes[target].kind === "drop") { finishBranch(c, p, null); return; }
  const failure = enter(c, p, target, from);
  if (failure) stop(c, { status: "failed", error: failure });
}
/** One transition enters every branch, in array order, or none of them (parallel §4.2). */
function split(c: Ctx, p: Position, source: string, outcome: string, from: From, targets: string[]): void {
  const { s } = c;
  const def = c.splits.find(x => x.node === source && x.outcome === outcome) as Split;
  const key = source + "#" + s.visits[source];
  const inst: SplitInstance = { node: source, visit: s.visits[source], outcome, gather: def.gather, targets, parent: p.split, branch: p.branch, arrivals: {} };
  const branches: Position[] = targets.map(t => ({ node: t, invocation: null, parked: false, from, split: key, branch: t }));
  // All targets are entered or none: commands are staged, and the counters are restored on failure.
  const inner: Ctx = { ...c, commands: [] };
  const saved = { visits: structuredClone(s.visits), activations: s.activations };
  for (const b of branches) {
    const failure = enter(inner, b, b.node, from);
    if (failure) { s.visits = saved.visits; s.activations = saved.activations; stop(c, { status: "failed", error: failure }); return; }
  }
  s.positions.splice(s.positions.indexOf(p), 1, ...branches);
  s.splits[key] = inst;
  c.commands.push(...inner.commands);
}
/** A branch reached its gather (an arrival) or a drop node (null). The gather then decides (parallel §4.5). */
function finishBranch(c: Ctx, p: Position, arrival: Arrivals[string]): void {
  const { s } = c;
  const key = p.split as string;
  const inst = s.splits[key];
  inst.arrivals[p.branch as string] = arrival;
  const at = s.positions.indexOf(p);
  s.positions.splice(at, 1);
  const def = splitOf(c, inst);
  const M = inst.targets.length;
  const open = inst.targets.filter(t => !(t in inst.arrivals));
  const arrived = inst.targets.filter(t => inst.arrivals[t]);
  let met: boolean, unmet: boolean;
  if (def.need === M) {
    met = inst.targets.every(t => inst.arrivals[t] || (def.optional.includes(t) && inst.arrivals[t] === null));
    unmet = inst.targets.some(t => inst.arrivals[t] === null && !def.optional.includes(t));
  } else {
    met = arrived.length >= def.need;
    unmet = arrived.length + open.length < def.need;
  }
  if ((def.losers === "wait" && open.length) || (!met && !unmet)) { refresh(s); return; }
  // Decided. Losers are discarded, in array order and depth-first; each open invocation gets a cancel command.
  const before = s.positions.slice(0, at).filter(x => !belongs(s, x.split, key)).length;
  s.positions = s.positions.filter(x => {
    if (!belongs(s, x.split, key)) return true;
    if (x.invocation) c.commands.push({ type: "cancel", invocationId: x.invocation.id });
    return false;
  });
  for (const k of Object.keys(s.splits)) if (belongs(s, k, key)) delete s.splits[k];
  const arrivals: Arrivals = Object.fromEntries(inst.targets.filter(t => t in inst.arrivals).map(t => [t, inst.arrivals[t]]));
  const g: Position = { node: inst.gather, invocation: null, parked: false, from: null, split: inst.parent, branch: inst.branch };
  s.positions.splice(before, 0, g);
  if (met) {
    const failure = enter(c, g, inst.gather, null, arrivals);
    if (failure) stop(c, { status: "failed", error: failure });
  } else {
    s.nodes[inst.gather] = { visit: s.visits[inst.gather] ?? 0, outcome: "unmet", output: null, arrivals };
    follow(c, g, inst.gather, "unmet", { node: inst.gather, outcome: "unmet", output: null });
  }
  refresh(s);
}
/** Records the node's result and takes its route (execution §2, §3). */
function route(c: Ctx, p: Position, outcome: string, output: Json): void {
  const { d, s } = c;
  const nodeId = p.node;
  const node = d.nodes[nodeId];
  if (!("routes" in node)) { stop(c, { status: "failed", error: { code: "workflow.unroutable", message: nodeId } }); return; }
  const visit = s.visits[nodeId] ?? 0;
  const prev = s.nodes[nodeId];
  s.nodes[nodeId] = { visit, outcome, output, ...(prev?.visit === visit && prev.arrivals ? { arrivals: prev.arrivals } : {}) };
  let chosen = outcome;
  if (node.loopLimits) {
    if (outcome in node.loopLimits) {
      const streak = s.streaks[nodeId];
      const n = streak?.outcome === outcome ? streak.count : 0;
      if (n + 1 > node.loopLimits[outcome]) { chosen = "exhausted"; delete s.streaks[nodeId]; c.diagnostics.push("loop.exhausted"); }
      else s.streaks[nodeId] = { outcome, count: n + 1 };
    } else delete s.streaks[nodeId];
  }
  follow(c, p, nodeId, chosen, { node: nodeId, outcome, output });
  refresh(s);
}
function retry(c: Ctx, p: Position): void {
  const inv = p.invocation;
  if (!inv) throw new Error("retry without invocation");
  invoke(c, p, inv.attempt + 1, inv.input, inv.params);
  refresh(c.s);
}
function operationalFailure(c: Ctx, p: Position, message: string): void {
  const n = c.d.nodes[p.node];
  p.invocation = null;
  if (n.kind === "activity" && Object.hasOwn(n.routes, "failed")) route(c, p, "failed", { error: message });
  else stop(c, { status: "failed", error: { code: "activity.failed", message } });
}

/** A pure reducer. The host persists command intents and delivers them after committing state. */
export function transition(definition: Definition, previous: RunState | null, event: Event): Decision {
  const problems = validateDefinition(definition);
  if (problems.length) throw new Error("invalid definition: " + problems.map(e => e.code + ": " + e.message).join("; "));
  const commands: Command[] = [];
  const diagnostics: string[] = [];
  const splits = analyze(definition).splits;
  if (!previous) {
    if (event.type !== "start") throw new Error("first event must be start");
    const s: RunState = { runId: event.runId, status: "running", input: event.input ?? {}, positions: [], splits: {}, visits: {}, activations: 0, nodes: {}, streaks: {} };
    const c: Ctx = { d: definition, s, splits, commands, diagnostics };
    const p: Position = { node: definition.start, invocation: null, parked: false, from: null, split: null, branch: null };
    s.positions.push(p);
    const failure = enter(c, p, definition.start, null);
    if (failure) stop(c, { status: "failed", error: failure });
    refresh(s);
    return { state: s, commands, diagnostics };
  }
  const s: RunState = structuredClone(previous);
  const c: Ctx = { d: definition, s, splits, commands, diagnostics };
  const done = (): Decision => ({ state: s, commands, diagnostics });
  if (TERMINAL.has(s.status)) { diagnostics.push("event.ignored-terminal"); return done(); }
  if (event.type === "start") { diagnostics.push("event.duplicate-start"); return done(); }
  if (event.type === "cancel") {
    if (s.pending) { diagnostics.push("run.cancel-ignored"); return done(); }
    diagnostics.push("run.cancel-requested");
    stop(c, { status: "cancelled" });
    return done();
  }
  if (event.type === "signal") {
    const p = s.positions.find(x => {
      const n = definition.nodes[x.node];
      return !x.invocation && !x.parked && n.kind === "await-signal" && n.signal === event.name && Object.hasOwn(n.routes, event.outcome) && !RESERVED.has(event.outcome);
    });
    if (!p) { diagnostics.push("signal.unmatched"); return done(); }
    route(c, p, event.outcome, event.output ?? null);
    return done();
  }
  const p = s.positions.find(x => x.invocation?.id === event.invocationId);
  if (event.type === "result") {
    if (!p || p.parked) { diagnostics.push("result.stale"); return done(); }
    const a = action(c, p.node) as ActionContract;
    const inv = p.invocation as NonNullable<Position["invocation"]>;
    const visit = s.visits[p.node];
    if (s.pending) {
      if (event.status === "unknown") { p.parked = true; diagnostics.push("invocation.unknown"); refresh(s); }
      else if (event.status === "success") settle(c, p, { visit, outcome: event.outcome ?? "ok", output: event.output ?? null });
      else settle(c, p, { visit, outcome: "failed", output: { error: event.error ?? "action failed" } });
      return done();
    }
    if (event.status === "success") {
      const outcome = event.outcome ?? "ok";
      if (!a.outcomes.includes(outcome)) operationalFailure(c, p, "undeclared outcome: " + outcome);
      else { p.invocation = null; route(c, p, outcome, event.output ?? null); }
    } else if (event.status === "unknown") {
      if (a.effect !== "unsafe" && inv.attempt < (a.retry?.maxAttempts ?? 1)) retry(c, p);
      else { p.parked = true; diagnostics.push("invocation.unknown"); refresh(s); }
    } else if (event.retryable && inv.attempt < (a.retry?.maxAttempts ?? 1)) retry(c, p);
    else operationalFailure(c, p, event.error ?? "action failed");
    return done();
  }
  // resolve
  if (!p || !p.parked) { diagnostics.push("resolution.not-applicable"); return done(); }
  const visit = s.visits[p.node];
  if (event.action === "retry") retry(c, p);
  else if (event.action === "fail") {
    if (s.pending) settle(c, p, { visit, outcome: "failed", output: { error: event.error ?? "resolved as failure" } });
    else operationalFailure(c, p, event.error ?? "resolved as failure");
  } else {
    const o = event.outcome ?? "ok";
    if (!(action(c, p.node)?.outcomes ?? []).includes(o)) { diagnostics.push("resolution.undeclared-outcome"); return done(); }
    if (s.pending) settle(c, p, { visit, outcome: o, output: event.output ?? null });
    else { p.invocation = null; route(c, p, o, event.output ?? null); }
  }
  return done();
}
