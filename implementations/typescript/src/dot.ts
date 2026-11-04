import type { Definition, Node, RouteTarget } from "./types";
import { validateDefinition } from "./validate";
import { analyze } from "./parallel";

type Settings = Pick<Definition, "actions" | "requires" | "limits" | "inputSchema"> & { nodes?: Record<string, Record<string, unknown>> };

type Token = { value: string; kind: "word" | "symbol" };
function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const rest = source.slice(i);
    if (/^\s/.test(rest)) { i++; continue; }
    if (rest.startsWith("//") || rest.startsWith("#")) { const end = source.indexOf("\n", i); i = end < 0 ? source.length : end + 1; continue; }
    if (rest.startsWith("/*")) { const end = source.indexOf("*/", i + 2); if (end < 0) throw new Error("unclosed comment"); i = end + 2; continue; }
    if (rest.startsWith("->")) { tokens.push({ value: "->", kind: "symbol" }); i += 2; continue; }
    if (rest[0] === '"') {
      let j = i + 1, escape = false;
      while (j < source.length) { const ch = source[j++]; if (ch === '"' && !escape) break; if (ch === "\\" && !escape) escape = true; else escape = false; }
      if (source[j-1] !== '"') throw new Error("unclosed quoted ID");
      const quoted = source.slice(i,j);
      let value: string;
      try { value = JSON.parse(quoted) as string; } catch { throw new Error("invalid quoted ID"); }
      tokens.push({ value, kind: "word" }); i=j; continue;
    }
    if (/^[{}\[\]=;,]/.test(rest)) { tokens.push({ value: rest[0], kind: "symbol" }); i++; continue; }
    const word = /^[A-Za-z_][A-Za-z0-9_]*|^[0-9]+/.exec(rest);
    if (word) { tokens.push({ value:word[0],kind:"word" }); i += word[0].length; continue; }
    throw new Error("unsupported DOT token near: " + rest.slice(0,20));
  }
  return tokens;
}

const PRESENTATION = ["label", "shape", "color", "fillcolor", "fontcolor"];
const NODE_ATTRS = ["kind", "need", "losers"];
const EDGE_ATTRS = ["on", "optional"];
const KEYWORDS = new Set(["subgraph", "graph", "node", "edge", "strict"]);
const TOPOLOGY = ["kind", "routes", "need", "optional", "losers"];

/** A deliberately narrow, independent SWL-DOT frontend (spec/notation.md). */
export function compileDot(source: string, settings: Settings = {}): Definition {
  const tokens = tokenize(source);
  let i = 0;
  const peek = () => tokens[i]?.value;
  const take = () => tokens[i++];
  const expect = (value: string): void => { if (take()?.value !== value) throw new Error("expected " + value); };
  const word = (): string => { const t = take(); if (!t || t.kind !== "word") throw new Error("expected identifier"); return t.value; };
  const attrs = (allowed: string[]): Record<string, string> => {
    const out: Record<string,string> = {};
    while (peek() === "[") {
      expect("[");
      while (peek() !== "]") {
        const key=word(); expect("="); const val=word();
        if (key in out) throw new Error("duplicate attribute: " + key);
        if (!allowed.includes(key) && !PRESENTATION.includes(key)) throw new Error("unsupported attribute: " + key);
        out[key]=val;
        if (peek() === "," || peek() === ";") take();
        else if (peek() !== "]") throw new Error("expected attribute separator");
      }
      expect("]");
    }
    return out;
  };
  /** One side of an edge: a node ID, or an unnamed, attribute-free group of node IDs (notation §2). */
  const operand = (): string[] => {
    if (peek() !== "{") return [word()];
    expect("{");
    const ids: string[] = [];
    while (peek() !== "}") {
      if (i >= tokens.length) throw new Error("unclosed group");
      const t = take();
      if (t.kind !== "word") throw new Error("a group may contain only node IDs");
      if (KEYWORDS.has(t.value)) throw new Error("unsupported DOT keyword in group: " + t.value);
      ids.push(t.value);
    }
    expect("}");
    if (!ids.length) throw new Error("empty group");
    if (new Set(ids).size !== ids.length) throw new Error("duplicate node in group");
    return ids.sort();
  };
  if (word().toLowerCase() !== "digraph") throw new Error("only a digraph is supported");
  const name=word(); expect("{");
  const kinds: Record<string,string> = {};
  const nodeAttrs: Record<string, Record<string, string>> = {};
  const routes: Record<string,Record<string,RouteTarget>> = {};
  const optionalEdges: [string, string][] = [];
  const mention=(id:string) => { if (!(id in kinds)) kinds[id]="activity"; };
  let start: string | undefined;
  while (peek() !== "}") {
    if (i >= tokens.length) throw new Error("unclosed digraph");
    if (peek() === ";") { take(); continue; }
    let first: string[];
    if (peek() === "{") first = operand();
    else {
      const w = word();
      if (KEYWORDS.has(w)) throw new Error("unsupported DOT keyword: " + w);
      if (w === "start" && peek() === "=") {
        expect("="); if (start) throw new Error("duplicate start"); start=word();
        if (peek() === ";") take();
        continue;
      }
      first = [w];
    }
    if (peek() === "->") {
      const chain=[first];
      while (peek() === "->") { expect("->"); chain.push(operand()); }
      const a=attrs(EDGE_ATTRS);
      if (a.optional !== undefined && a.optional !== "true") throw new Error("optional must be true");
      for (const ids of chain) ids.forEach(mention);
      for (let c=0;c<chain.length-1;c++){
        const ys = chain[c+1], outcome=a.on ?? "ok";
        for (const x of chain[c]) {
          routes[x] ??= {};
          if (outcome in routes[x]) throw new Error("duplicate route: " + x + "." + outcome);
          routes[x][outcome] = ys.length > 1 ? [...ys] : ys[0];
          if (a.optional) for (const y of ys) optionalEdges.push([x, y]);
        }
      }
    } else {
      if (first.length !== 1 || tokens[i-1].value === "}") throw new Error("a group must be part of an edge statement");
      const id = first[0];
      mention(id);
      const a=attrs(NODE_ATTRS);
      if (a.kind && !["activity","await-signal","complete","fail","drop"].includes(a.kind)) throw new Error("unknown kind: " + a.kind);
      if (a.kind && kinds[id] !== "activity" && kinds[id] !== a.kind) throw new Error("conflicting kind for: " + id);
      if (a.kind) kinds[id]=a.kind;
      nodeAttrs[id] ??= {};
      for (const k of ["need", "losers"]) if (a[k] !== undefined) {
        if (nodeAttrs[id][k] !== undefined && nodeAttrs[id][k] !== a[k]) throw new Error("conflicting " + k + " for: " + id);
        nodeAttrs[id][k] = a[k];
      }
    }
    if (peek() === ";") take();
  }
  expect("}"); if (i !== tokens.length) throw new Error("trailing tokens");
  if (!start) throw new Error("missing start");
  const nodes: Record<string,Node> = {};
  for (const [id,kind] of Object.entries(kinds)) {
    const config=settings.nodes?.[id]??{};
    for (const k of TOPOLOGY) if (k in config) throw new Error("settings may not redefine topology: " + id + "." + k);
    const extra: Record<string, unknown> = {};
    const need = nodeAttrs[id]?.need;
    if (need !== undefined) extra.need = /^[0-9]+$/.test(need) ? Number(need) : need;
    if (nodeAttrs[id]?.losers !== undefined) extra.losers = nodeAttrs[id].losers;
    nodes[id]={kind, ...config, ...(kind==="activity"||kind==="await-signal"?{routes:routes[id]??{}}:{}), ...extra} as Node;
  }
  for (const id of Object.keys(settings.nodes??{})) if (!(id in kinds)) throw new Error("settings mention unknown node: " + id);
  const definition: Definition = {language:"swl",name,start,nodes,...(settings.actions?{actions:settings.actions}:{}),...(settings.limits?{limits:settings.limits}:{}),...(settings.requires?{requires:settings.requires}:{}),...(settings.inputSchema?{inputSchema:settings.inputSchema}:{})};
  if (optionalEdges.length) markOptional(definition, optionalEdges);
  const errors=validateDefinition(definition);
  if (errors.length) throw new Error(errors.map(e=>e.code+": "+e.message).join("; "));
  return definition;
}

/** `optional=true` on an arrow into a gather marks that branch's arrival optional (notation §3). */
function markOptional(definition: Definition, edges: [string, string][]): void {
  const { splits } = analyze(definition); // the definition is validated as a whole once optional is applied
  for (const [x, y] of edges) {
    const split = splits.find(s => s.gather === y);
    const branch = split?.targets.find(b => split.regions[b].has(x));
    if (!split || !branch) throw new Error("optional is only valid on an arrow from a branch into its gather: " + x + " -> " + y);
    // Every arrow from that branch into the gather must agree.
    for (const id of split.regions[branch]) {
      const n = definition.nodes[id];
      if (!("routes" in n)) continue;
      for (const t of Object.values(n.routes)) if (t === y && !edges.some(([ex, ey]) => ex === id && ey === y)) throw new Error("only some arrows from branch " + branch + " into " + y + " are optional");
    }
    const g = definition.nodes[y];
    const list = (g.optional ??= []);
    if (!list.includes(branch)) { list.push(branch); list.sort(); }
  }
}
