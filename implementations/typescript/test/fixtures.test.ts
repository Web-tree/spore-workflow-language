import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { compileDot, transition, validateDefinition } from "../src/index";
import type { Command, Definition, Event, Json, RunState } from "../src/index";

/** Runs the repository's conformance fixtures (spec/fixtures.md) against this implementation. */

const ROOT = join(import.meta.dir, "..", "..", "..", "fixtures");
const CLAIMED = ["core"];

interface Fixture { name: string; fixture: string; title: string; profiles: string[]; [key: string]: unknown }
interface Ref { node: string; visit: number }
interface Step { event: Record<string, unknown>; expect: Record<string, unknown> }

function load(kind: string): Fixture[] {
  const dir = join(ROOT, kind);
  return readdirSync(dir).filter(f => f.endsWith(".json")).sort()
    .map(f => ({ ...(JSON.parse(readFileSync(join(dir, f), "utf8")) as Fixture), name: f }));
}
const claims = (f: Fixture): boolean => f.profiles.every(p => CLAIMED.includes(p));
const run = (f: Fixture) => (claims(f) ? test : test.skip);

describe("definition fixtures", () => {
  for (const f of load("definition")) {
    run(f)(`${f.name}: ${f.title}`, () => {
      const want = f.expect as { valid?: boolean; errors?: string[] };
      const codes = validateDefinition(f.definition as Definition, (f.supported as string[] | undefined) ?? CLAIMED).map(e => e.code);
      if (want.valid) expect(codes).toEqual([]);
      else for (const code of want.errors ?? []) expect(codes).toContain(code);
    });
  }
});

describe("dot fixtures", () => {
  for (const f of load("dot")) {
    run(f)(`${f.name}: ${f.title}`, () => {
      const want = f.expect as { definition?: Definition; rejected?: boolean };
      const compile = () => compileDot(f.source as string, f.settings as Parameters<typeof compileDot>[1]);
      if (want.rejected) expect(compile).toThrow();
      else expect(compile()).toEqual(want.definition as Definition);
    });
  }
});

describe("trace fixtures", () => {
  for (const f of load("trace")) {
    run(f)(`${f.name}: ${f.title}`, () => runTrace(f));
  }
});

function runTrace(f: Fixture): void {
  const definition = f.definition as Definition;
  const ids = new Map<string, string>();   // "node#visit" -> this implementation's invocation ID
  const refs = new Map<string, Ref>();     // invocation ID -> reference
  const key = (r: Ref): string => r.node + "#" + r.visit;

  const toEvent = (e: Record<string, unknown>): Event => {
    if (e.type === "result" || e.type === "resolve") {
      const { invocation, ...rest } = e as { invocation: Ref } & Record<string, unknown>;
      return { ...rest, invocationId: ids.get(key(invocation)) ?? "never-created:" + key(invocation) } as Event;
    }
    return e as Event;
  };
  const portable = (c: Command, state: RunState): Json => {
    if (c.type === "invoke") {
      const ref: Ref = { node: c.nodeId, visit: state.visits[c.nodeId] ?? 0 };
      ids.set(key(ref), c.invocationId);
      refs.set(c.invocationId, ref);
      return { type: "invoke", node: ref.node, visit: ref.visit, attempt: c.attempt, action: c.action, input: c.input, params: c.params };
    }
    const ref = refs.get(c.invocationId) ?? { node: "?", visit: 0 };
    return { type: "cancel", invocation: { node: ref.node, visit: ref.visit } };
  };

  let state: RunState | null = null;
  (f.steps as Step[]).forEach((step, i) => {
    const at = `step ${i + 1} (${String(step.event.type)})`;
    try {
      const d = transition(definition, state, toEvent(step.event));
      state = d.state;
      const commands = d.commands.map(c => portable(c, d.state));
      const x = step.expect;
      if ("status" in x) expect(d.state.status).toBe(x.status as RunState["status"]);
      if ("positions" in x) expect(d.state.position ? [d.state.position] : []).toEqual(x.positions as string[]);
      if ("commands" in x) expect(commands).toEqual(x.commands as Json[]);
      if ("diagnostics" in x) for (const g of x.diagnostics as string[]) expect(d.diagnostics).toContain(g);
      if ("nodes" in x) for (const [id, record] of Object.entries(x.nodes as Record<string, unknown>)) expect(d.state.nodes[id]).toEqual(record as RunState["nodes"][string]);
      if ("result" in x) expect(d.state.result ?? null).toEqual(x.result as Json);
      if ("error" in x) {
        const e = x.error as { code: string; message?: string };
        expect(d.state.error?.code).toBe(e.code);
        if (e.message !== undefined) expect(d.state.error?.message).toBe(e.message);
      }
    } catch (error) {
      throw new Error(at + ": " + (error instanceof Error ? error.message : String(error)));
    }
  });
}
