import type { Definition, Node } from "./types";
import { validateDefinition } from "./validate";

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
    const word = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest);
    if (word) { tokens.push({ value:word[0],kind:"word" }); i += word[0].length; continue; }
    throw new Error("unsupported DOT token near: " + rest.slice(0,20));
  }
  return tokens;
}

/** A deliberately narrow, independent SWL-DOT frontend. */
export function compileDot(source: string, settings: Settings = {}): Definition {
  const tokens = tokenize(source);
  let i = 0;
  const peek = () => tokens[i]?.value;
  const take = () => tokens[i++];
  const expect = (value: string): void => { if (take()?.value !== value) throw new Error("expected " + value); };
  const word = (): string => { const t = take(); if (!t || t.kind !== "word") throw new Error("expected identifier"); return t.value; };
  const attrs = (): Record<string, string> => {
    const out: Record<string,string> = {};
    while (peek() === "[") {
      expect("[");
      while (peek() !== "]") {
        const key=word(); expect("="); const val=word();
        if (key in out) throw new Error("duplicate attribute: " + key);
        if (!["kind","on","label","shape","color","fillcolor","fontcolor"].includes(key)) throw new Error("unsupported attribute: " + key);
        out[key]=val;
        if (peek() === "," || peek() === ";") take();
        else if (peek() !== "]") throw new Error("expected attribute separator");
      }
      expect("]");
    }
    return out;
  };
  if (word().toLowerCase() !== "digraph") throw new Error("only a digraph is supported");
  const name=word(); expect("{");
  const kinds: Record<string,string> = {};
  const routes: Record<string,Record<string,string>> = {};
  const mention=(id:string) => { if (!(id in kinds)) kinds[id]="activity"; };
  let start: string | undefined;
  while (peek() !== "}") {
    if (i >= tokens.length) throw new Error("unclosed digraph");
    if (peek() === ";") { take(); continue; }
    const from=word();
    if (from === "start" && peek() === "=") {
      expect("="); if (start) throw new Error("duplicate start"); start=word();
    } else if (peek() === "->") {
      const chain=[from];
      while (peek() === "->") { expect("->"); chain.push(word()); }
      const a=attrs(); for (const k of Object.keys(a)) if (k !== "on" && !["label","shape","color","fillcolor","fontcolor"].includes(k)) throw new Error("unsupported edge attribute: "+k);
      for (const id of chain) mention(id);
      for (let c=0;c<chain.length-1;c++){
        const x=chain[c], y=chain[c+1], outcome=a.on ?? "ok";
        routes[x] ??= {};
        if (outcome in routes[x]) throw new Error("duplicate route: " + x + "." + outcome);
        routes[x][outcome]=y;
      }
    } else {
      mention(from);
      const a=attrs(); if (a.on !== undefined) throw new Error("on only valid on an edge");
      if (a.kind && !["activity","await-signal","complete","fail"].includes(a.kind)) throw new Error("unknown kind: " + a.kind);
      if (a.kind && kinds[from] !== "activity" && kinds[from] !== a.kind) throw new Error("conflicting kind for: " + from);
      if (a.kind) kinds[from]=a.kind;
    }
    if (peek() === ";") take();
  }
  expect("}"); if (i !== tokens.length) throw new Error("trailing tokens");
  if (!start) throw new Error("missing start");
  const nodes: Record<string,Node> = {};
  for (const [id,kind] of Object.entries(kinds)) {
    const config=settings.nodes?.[id]??{};
    if ("kind" in config || "routes" in config) throw new Error("settings may not redefine topology: " + id);
    nodes[id]={kind, ...config, ...(kind==="activity"||kind==="await-signal"?{routes:routes[id]??{}}:{})} as Node;
  }
  for (const id of Object.keys(settings.nodes??{})) if (!(id in kinds)) throw new Error("settings mention unknown node: " + id);
  const definition: Definition = {language:"swl",name,start,nodes,...(settings.actions?{actions:settings.actions}:{}),...(settings.limits?{limits:settings.limits}:{}),...(settings.requires?{requires:settings.requires}:{}),...(settings.inputSchema?{inputSchema:settings.inputSchema}:{})};
  const errors=validateDefinition(definition);
  if (errors.length) throw new Error(errors.join("; "));
  return definition;
}
