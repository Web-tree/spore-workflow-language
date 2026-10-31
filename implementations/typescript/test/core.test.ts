import { describe, expect, test } from "bun:test";
import { compileDot, transition, validateDefinition } from "../src/index";
import type { Definition } from "../src/index";

const hello:Definition={
  language:"swl",name:"hello",start:"greet",
  actions:{greet:{effect:"read-only",outcomes:["ok"]}},
  nodes:{
    greet:{kind:"activity",action:"greet",input:{"$get":["input"]},routes:{ok:"done"}},
    done:{kind:"complete",output:{"$get":["nodes","greet","output"]}}
  }
};
describe("independent sequential core",()=>{
  test("validates and completes an activity without running the effect in the reducer",()=>{
    expect(validateDefinition(hello)).toEqual([]);
    const started=transition(hello,null,{type:"start",runId:"one",input:{task:"hello"}});
    expect(started.state.status).toBe("running");
    expect(started.commands).toHaveLength(1);
    expect(started.commands[0]).toMatchObject({type:"invoke",input:{task:"hello"},idempotencyKey:"one:greet:1"});
    const finished=transition(hello,started.state,{type:"result",invocationId:"one:greet:1",status:"success",outcome:"ok",output:{greeting:"hi"}});
    expect(finished.state.status).toBe("completed");
    expect(finished.state.result).toEqual({greeting:"hi"});
    expect(started.state.status).toBe("running"); // immutable transition
  });
  test("parses an SWL-DOT authoring graph and makes style non-semantic",()=>{
    const src='digraph "hello" { start="greet"; greet [kind="activity",label="First"]; done [kind="complete"]; greet -> done; }';
    const settings={actions:hello.actions,nodes:{greet:{action:"greet",input:{"$get":["input"]}},done:{output:{"$get":["nodes","greet","output"]}}}};
    const a=compileDot(src,settings);
    const b=compileDot(src.replace("First","Second"),settings);
    expect(a).toEqual(b);
    expect(a).toEqual(hello);
  });
  test("wait signal routes by named outcome",()=>{
    const d:Definition={language:"swl",name:"approval",start:"review",nodes:{
      review:{kind:"await-signal",signal:"approval",routes:{yes:"done",no:"stop"}},
      done:{kind:"complete"},stop:{kind:"fail",error:{code:"denied",message:"no"}}
    }};
    const started=transition(d,null,{type:"start",runId:"two"});
    expect(started.state.status).toBe("waiting");
    const ignored=transition(d,started.state,{type:"signal",name:"other",outcome:"yes"});
    expect(ignored.diagnostics).toContain("signal.unmatched");
    expect(ignored.state.status).toBe("waiting");
    const done=transition(d,started.state,{type:"signal",name:"approval",outcome:"yes"});
    expect(done.state.status).toBe("completed");
  });
  test("retries unknown repeatable invocation under same key",()=>{
    const d:Definition=structuredClone(hello);d.actions!.greet.retry={maxAttempts:2};
    const start=transition(d,null,{type:"start",runId:"three"});
    const next=transition(d,start.state,{type:"result",invocationId:"three:greet:1",status:"unknown"});
    expect(next.state.invocation?.attempt).toBe(2);
    expect(next.commands[0]).toMatchObject({type:"invoke",invocationId:"three:greet:1",attempt:2,idempotencyKey:"three:greet:1"});
    expect(transition(d,next.state,{type:"result",invocationId:"three:greet:1",status:"unknown"}).state.status).toBe("needs-intervention");
  });
  test("unsafe unknown never repeats automatically",()=>{
    const d:Definition=structuredClone(hello);d.actions!.greet.effect="unsafe";d.actions!.greet.retry={maxAttempts:4};
    const start=transition(d,null,{type:"start",runId:"four"});
    const next=transition(d,start.state,{type:"result",invocationId:"four:greet:1",status:"unknown"});
    expect(next.commands).toHaveLength(0);
    expect(next.state.status).toBe("needs-intervention");
    expect(transition(d,next.state,{type:"resolve",invocationId:"four:greet:1",action:"complete",outcome:"ok",output:"done"}).state.status).toBe("completed");
  });
  test("loop exhaustion is not a retry",()=>{
    const d:Definition={language:"swl",name:"loop",start:"check",actions:{check:{effect:"pure",outcomes:["red","ok"]}},
      nodes:{check:{kind:"activity",action:"check",loopLimits:{red:2},routes:{red:"check",ok:"done",exhausted:"stop"}},done:{kind:"complete"},stop:{kind:"fail",error:{code:"exhausted",message:"stopped"}}}};
    let x=transition(d,null,{type:"start",runId:"loop"});
    x=transition(d,x.state,{type:"result",invocationId:"loop:check:1",status:"success",outcome:"red"});
    expect(x.state.invocation?.id).toBe("loop:check:2");
    x=transition(d,x.state,{type:"result",invocationId:"loop:check:2",status:"success",outcome:"red"});
    x=transition(d,x.state,{type:"result",invocationId:"loop:check:3",status:"success",outcome:"red"});
    expect(x.state.status).toBe("failed");
    expect(x.state.error?.code).toBe("exhausted");
    expect(x.diagnostics).toContain("loop.exhausted");
  });
  test("rejects dangling and missing business routes",()=>{
    const d:Definition=structuredClone(hello);(d.nodes.greet as {routes:Record<string,string>}).routes={bad:"nowhere"};
    const errors=validateDefinition(d);
    expect(errors.some(x=>x.includes("unknown route target"))).toBe(true);
    expect(errors.some(x=>x.includes("missing outcome route"))).toBe(true);
  });
  test("rejects unsupported required profiles",()=>{
    const d:Definition=structuredClone(hello);d.requires=["core","parallel"];
    expect(validateDefinition(d)).toContain("unsupported required profile: parallel");
  });
});
