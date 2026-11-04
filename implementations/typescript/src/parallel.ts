import type { Definition, Json, Node, RouteTarget } from "./types";

/**
 * Static analysis for the parallel profile (spec/parallel.md §3, §4): finds every split's gather and
 * regions from the shape of the graph, and reports the P1–P15 rules.
 */

export interface Split {
  node: string;
  outcome: string;
  targets: string[];
  gather: string;
  /** Branch name (its first node) -> the nodes of that branch. */
  regions: Record<string, Set<string>>;
  need: number;
  optional: string[];
  losers: "stop" | "wait";
  canMiss: boolean;
  canLeaveLosers: boolean;
}
export interface Analysis { splits: Split[]; errors: { code: string; message: string }[] }

export const PARALLEL_PROFILE = "parallel";
export const targetsOf = (r: RouteTarget): string[] => (Array.isArray(r) ? r : [r]);
const ENDS = new Set(["fail", "drop"]);
const kind = (d: Definition, id: string): string | undefined => d.nodes[id]?.kind;
const routesOf = (n: Node | undefined): Record<string, RouteTarget> => (n && "routes" in n && n.routes && typeof n.routes === "object" ? n.routes : {});

/** Nodes reachable from `from` (inclusive) along routes, never entering a blocked node. Unknown IDs are ignored. */
function reach(d: Definition, from: string, blocked: ReadonlySet<string>): Set<string> {
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length) {
    const id = stack.pop() as string;
    if (seen.has(id) || blocked.has(id) || !d.nodes[id]) continue;
    seen.add(id);
    for (const r of Object.values(routesOf(d.nodes[id]))) stack.push(...targetsOf(r));
  }
  return seen;
}
const minus = (s: Set<string>, pred: (id: string) => boolean): Set<string> => new Set([...s].filter(id => !pred(id)));

/** Every `$get` path in a mapping, outside `$literal`. */
export function paths(value: Json | undefined, out: (string | number)[][] = []): (string | number)[][] {
  if (Array.isArray(value)) value.forEach(v => paths(v, out));
  else if (value && typeof value === "object") {
    const keys = Object.keys(value);
    if (keys.length === 1 && keys[0] === "$literal") return out;
    if (keys.length === 1 && keys[0] === "$get" && Array.isArray(value.$get)) out.push(value.$get as (string | number)[]);
    else keys.forEach(k => paths(value[k], out));
  }
  return out;
}
const mappings = (n: Node): Json[] => {
  const out: Json[] = [];
  if (n.kind === "activity") { if (n.input !== undefined) out.push(n.input); if (n.params !== undefined) out.push(n.params); }
  if (n.kind === "complete" && n.output !== undefined) out.push(n.output);
  return out;
};

export function analyze(d: Definition): Analysis {
  const errors: Analysis["errors"] = [];
  const err = (n: number, message: string): void => { errors.push({ code: "parallel.p" + n, message }); };
  const ids = Object.keys(d.nodes);
  const declared = (d.requires ?? ["core"]).includes(PARALLEL_PROFILE);
  const gatherMembers = (n: Node): string[] => ["need", "optional", "losers"].filter(k => k in n);

  // P1: nothing of this profile without declaring it.
  if (!declared) {
    for (const id of ids) {
      const n = d.nodes[id];
      if (n.kind === "drop") err(1, "drop node without the parallel profile: " + id);
      for (const k of gatherMembers(n)) err(1, "gather member without the parallel profile: " + id + "." + k);
      for (const [o, r] of Object.entries(routesOf(n))) {
        if (Array.isArray(r)) err(1, "split without the parallel profile: " + id + "." + o);
        if (o === "unmet") err(1, "unmet route without the parallel profile: " + id);
      }
    }
    return { splits: [], errors };
  }
  if (!(d.requires ?? []).includes("core")) err(1, "parallel requires core");

  // Find each split's gather and regions (spec/parallel.md §3).
  const splits: Split[] = [];
  for (const S of ids) {
    for (const [outcome, r] of Object.entries(routesOf(d.nodes[S]))) {
      if (!Array.isArray(r)) continue;
      const targets = r.filter(t => typeof t === "string" && t in d.nodes);
      const M = targets.length;
      if (M < 2 || r.length !== M) { if (r.length >= 2) err(2, "split with unknown targets: " + S + "." + outcome); continue; }
      const sorted = [...targets].sort();
      if (targets.some((t, i) => t !== sorted[i]) || new Set(targets).size !== M) err(8, "split targets must be unique and ascending: " + S + "." + outcome);
      const R = Object.fromEntries(targets.map(t => [t, minus(reach(d, t, new Set([S])), id => ENDS.has(kind(d, id) as string))]));
      const C = new Set(ids.filter(id => targets.filter(t => R[t].has(id)).length >= 2));
      const candidates = [...C].filter(G => targets.every(t => [...reach(d, t, new Set([S, G]))].every(id => !C.has(id))));
      if (candidates.length !== 1) { err(2, "split has no single gather: " + S + "." + outcome); continue; }
      const gather = candidates[0];
      const regions: Record<string, Set<string>> = {};
      for (const t of targets) {
        if (t === gather) err(2, "split target is its own gather: " + S + "." + outcome + " -> " + t);
        else if (!R[t].has(gather)) err(2, "branch has no path to the gather: " + S + "." + outcome + " -> " + t);
        regions[t] = minus(reach(d, t, new Set([S, gather])), id => ENDS.has(kind(d, id) as string));
      }
      const g = d.nodes[gather];
      const rawNeed = g.need ?? "all";
      let need = M;
      if (rawNeed === "any") need = 1;
      else if (rawNeed !== "all") {
        if (Number.isInteger(rawNeed) && (rawNeed as number) >= 1 && (rawNeed as number) <= M) need = rawNeed as number;
        else err(8, "need must be all, any or 1.." + M + ": " + gather);
      }
      const optional = Array.isArray(g.optional) ? g.optional.filter((o): o is string => typeof o === "string") : [];
      const losers = g.losers === "wait" ? "wait" : "stop";
      if (g.losers !== undefined && g.losers !== "stop" && g.losers !== "wait") err(8, "losers must be stop or wait: " + gather);
      splits.push({ node: S, outcome, targets, gather, regions, need, optional, losers, canMiss: false, canLeaveLosers: false });
    }
  }

  const regionOf = (s: Split, id: string): string | undefined => s.targets.find(b => s.regions[b].has(id));
  const inAnyRegion = (id: string): boolean => splits.some(s => regionOf(s, id) !== undefined);
  const gathers = new Set(splits.map(s => s.gather));
  // Nesting: the split whose region contains this split's node, innermost first.
  const parentsOf = (s: Split): { split: Split; branch: string }[] =>
    splits.filter(p => p !== s).flatMap(p => { const b = regionOf(p, s.node); return b ? [{ split: p, branch: b }] : []; })
      .sort((x, y) => x.split.regions[x.branch].size - y.split.regions[y.branch].size);
  const nestedIn = (s: Split, b: string): Split[] => splits.filter(x => x !== s && s.regions[b].has(x.node));
  const own = (s: Split, b: string): Set<string> => {
    const inner = new Set(nestedIn(s, b).flatMap(x => x.targets.flatMap(t => [...x.regions[t]])));
    return minus(s.regions[b], id => inner.has(id));
  };
  const canDrop = (s: Split, b: string): boolean => [...own(s, b)].some(id => Object.values(routesOf(d.nodes[id])).some(r => targetsOf(r).some(t => kind(d, t) === "drop")));

  for (const s of splits) {
    const M = s.targets.length;
    const g = d.nodes[s.gather];
    const where = s.node + "." + s.outcome;
    const dropping = s.targets.filter(b => canDrop(s, b));
    s.canMiss = s.need === M ? dropping.some(b => !s.optional.includes(b)) : dropping.length > M - s.need;
    s.canLeaveLosers = s.need < M || s.canMiss;
    const routes = routesOf(g);

    // P3: disjoint regions.
    for (let i = 0; i < M; i++) for (let j = i + 1; j < M; j++) {
      const shared = [...s.regions[s.targets[i]]].filter(id => s.regions[s.targets[j]].has(id));
      if (shared.length) err(3, "regions share nodes: " + where + " (" + shared.sort().join(", ") + ")");
    }
    for (const b of s.targets) {
      for (const id of s.regions[b]) {
        const n = d.nodes[id];
        // P4: a region node stays in its region, or goes to the gather, a fail node or a drop node.
        for (const r of Object.values(routesOf(n))) for (const t of targetsOf(r)) {
          if (!s.regions[b].has(t) && t !== s.gather && !ENDS.has(kind(d, t) as string)) err(4, "route leaves its region: " + id + " -> " + t);
        }
        if (n.kind === "complete") err(6, "complete node inside a region: " + id);
        // P7: a way out exists.
        const out = reach(d, id, new Set([s.node]));
        if (![...out].some(x => x === s.gather || ENDS.has(kind(d, x) as string))) err(7, "region node cannot reach the gather, a fail node or a drop node: " + id);
        // P11: no reading across regions.
        for (const m of mappings(n)) for (const p of paths(m)) {
          if (p[0] === "nodes" && typeof p[1] === "string") { const other = regionOf(s, p[1]); if (other !== undefined && other !== b) err(11, "mapping reads another region: " + id + " reads " + p[1]); }
        }
      }
    }
    // P5: the only ways in are the split (into a region) and the regions (into the gather).
    for (const X of ids) for (const [o, r] of Object.entries(routesOf(d.nodes[X]))) for (const Y of targetsOf(r)) {
      const b = regionOf(s, Y);
      if (b !== undefined && !s.regions[b].has(X) && !(X === s.node && o === s.outcome && Y === b)) err(5, "route into a region from outside: " + X + " -> " + Y);
      if (Y === s.gather && regionOf(s, X) === undefined) err(5, "route into a gather from outside its regions: " + X + " -> " + Y);
    }
    if (regionOf(s, d.start) !== undefined) err(5, "start inside a region: " + d.start);
    if (d.start === s.gather) err(5, "start is a gather: " + d.start);
    // P8, P9: need and the unmet route.
    if ("unmet" in routes && !s.canMiss) err(8, "unmet route on a gather that cannot miss its need: " + s.gather);
    if (s.canMiss) {
      if (!("routes" in g)) err(9, "terminal gather can miss its need: " + s.gather);
      else if (!("unmet" in routes)) err(9, "gather can miss its need and has no unmet route: " + s.gather);
    }
    // P10: optional.
    if (s.optional.length) {
      if (s.need !== M) err(10, "optional beside a need below all: " + s.gather);
      for (const o of s.optional) if (!s.targets.includes(o)) err(10, "optional names no branch of the split: " + s.gather + " optional " + o);
      if (s.targets.every(b => s.optional.includes(b))) err(10, "every arrival is optional: " + s.gather);
    }
    // P12: one waiter per signal name across regions.
    const waiters: Record<string, string> = {};
    for (const b of s.targets) for (const id of s.regions[b]) {
      const n = d.nodes[id];
      if (n.kind !== "await-signal" || typeof n.signal !== "string") continue;
      if (waiters[n.signal] !== undefined && waiters[n.signal] !== b) err(12, "two regions wait on signal " + n.signal + ": " + where);
      waiters[n.signal] = b;
    }
    // P13: stopping losers must be safe to abandon.
    if (s.losers === "stop" && s.canLeaveLosers) {
      for (const b of s.targets) for (const id of s.regions[b]) {
        const n = d.nodes[id];
        if (n.kind === "activity" && d.actions?.[n.action]?.effect === "unsafe") err(13, "losers stop with an unsafe activity in a region: " + id);
      }
    }
    // P15: one gather per split, and nesting stays inside.
    if (splits.filter(x => x.gather === s.gather).length > 1) err(15, "node is the gather of more than one split: " + s.gather);
    const parent = parentsOf(s)[0];
    if (parent) {
      const outer = parent.split.regions[parent.branch];
      if (!outer.has(s.gather)) err(15, "nested gather outside the region that contains its split: " + s.gather);
      for (const b of s.targets) for (const id of s.regions[b]) if (!outer.has(id)) err(15, "nested region leaves the region that contains its split: " + id);
    }
  }
  // P8 (members), P11 (arrivals), P14 (drop) on every node.
  for (const id of ids) {
    const n = d.nodes[id];
    if (!gathers.has(id)) {
      for (const k of gatherMembers(n)) err(8, "gather member on a node that is not a gather: " + id + "." + k);
      if ("unmet" in routesOf(n)) err(8, "unmet route on a node that is not a gather: " + id);
      for (const m of mappings(n)) for (const p of paths(m)) if (p[0] === "arrivals") err(11, "arrivals read on a node that is not a gather: " + id);
    }
    if (!inAnyRegion(id)) for (const r of Object.values(routesOf(n))) for (const t of targetsOf(r)) if (kind(d, t) === "drop") err(14, "route to a drop node from outside a region: " + id + " -> " + t);
  }
  return { splits, errors };
}
