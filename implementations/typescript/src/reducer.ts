import type { ActionContract, Command, Decision, Definition, Event, From, Invocation, Json, Node, RunState } from "./types";
import { validateDefinition } from "./validate";

/** Only portable, deterministic $get / $literal operators are in this small draft core. */
export function evaluate(value: Json | undefined, state: RunState): Json {
  if (value === undefined) return null;
  if (Array.isArray(value)) return value.map(item => evaluate(item, state));
  if (value !== null && typeof value === "object") {
    const keys=Object.keys(value);
    if (keys.length === 1 && keys[0] === "$literal") return structuredClone(value.$literal);
    if (keys.length === 1 && keys[0] === "$get") {
      const steps=value.$get;
      if (!Array.isArray(steps) || steps.length < 1 || steps.some(s=>typeof s!=="string" && (!Number.isInteger(s) || (s as number)<0))) throw new Error("invalid $get path");
      const context: Record<string, unknown>={input:state.input,nodes:state.nodes,from:state.from,run:{id:state.runId}};
      let cursor: unknown=context;
      for (const s of steps) {
        if (cursor===null || typeof cursor!=="object" || !(s as string in cursor)) throw new Error("missing mapping path: " + JSON.stringify(steps));
        cursor=(cursor as Record<string,unknown>)[s as string];
      }
      return structuredClone(cursor) as Json;
    }
    if (keys.some(k=>k.startsWith("$"))) throw new Error("unknown mapping operator");
    return Object.fromEntries(keys.map(k=>[k,evaluate(value[k],state)]));
  }
  return value;
}
function failed(s:RunState,code:string,message:string): void {
  s.status="failed"; s.position=null; s.invocation=null; s.error={code,message};
  s.result=null;
}
function enter(d:Definition,s:RunState,nodeId:string,commands:Command[],diagnostics:string[],from:From|null):void {
  const node=d.nodes[nodeId];
  if (!node) { failed(s,"workflow.missing-node",nodeId); return; }
  const visit=(s.visits[nodeId]??0)+1;
  if (visit>(d.limits?.maxVisitsPerNode??16)||s.activations+1>(d.limits?.maxActivations??256)){
    failed(s,"workflow.limit-exceeded",nodeId); return;
  }
  s.visits[nodeId]=visit; s.activations++;
  s.position=nodeId; s.from=from;
  if (node.kind==="activity") {
    let input:Json,params:Json;
    try { input=evaluate(node.input,s); params=evaluate(node.params,s); }
    catch(e) { failed(s,"mapping.invalid",String(e)); return; }
    const id=s.runId+":"+nodeId+":"+visit;
    s.invocation={id,nodeId,attempt:1,input,params};s.status="running";
    commands.push({type:"invoke",invocationId:id,nodeId,action:node.action,attempt:1,idempotencyKey:id,input,params});
  } else if (node.kind==="await-signal") { s.invocation=null; s.status="waiting"; }
  else if (node.kind==="complete") {
    try { s.result=evaluate(node.output,s);s.status="completed";s.position=null;s.invocation=null; }
    catch(e) { failed(s,"mapping.invalid",String(e)); }
  } else { failed(s,node.error.code,node.error.message); }
}
function route(d:Definition,s:RunState,nodeId:string,outcome:string,output:Json,commands:Command[],diagnostics:string[]):void{
  const node=d.nodes[nodeId];
  if (!node || !("routes" in node)) { failed(s,"workflow.unroutable",nodeId);return; }
  const visit=s.visits[nodeId]??0;
  s.nodes[nodeId]={visit,outcome,output};
  let chosen=outcome;
  if(node.loopLimits){
    if(outcome in node.loopLimits){
      const prev=s.streaks[nodeId];
      const n=prev?.outcome===outcome?prev.count:0;
      if(n+1>node.loopLimits[outcome]){chosen="exhausted";delete s.streaks[nodeId];diagnostics.push("loop.exhausted");}
      else s.streaks[nodeId]={outcome,count:n+1};
    } else delete s.streaks[nodeId];
  }
  const target=node.routes[chosen];
  if(!target){failed(s,"workflow.no-route",nodeId+"."+chosen);return;}
  enter(d,s,target,commands,diagnostics,{node:nodeId,outcome,output});
}
function invokeAgain(d:Definition,s:RunState,commands:Command[]):void{
  const inv=s.invocation;
  if(!inv) throw new Error("retry without invocation");
  const n=d.nodes[inv.nodeId];
  if(n.kind!=="activity") throw new Error("retry on non-activity");
  inv.attempt++;
  s.status="running";
  commands.push({type:"invoke",invocationId:inv.id,nodeId:inv.nodeId,action:n.action,attempt:inv.attempt,idempotencyKey:inv.id,input:inv.input,params:inv.params});
}
function operationalFailure(d:Definition,s:RunState,nodeId:string,message:string,commands:Command[],diagnostics:string[]):void {
  const n=d.nodes[nodeId];
  if (n.kind==="activity" && "failed" in n.routes) route(d,s,nodeId,"failed",{error:message},commands,diagnostics);
  else failed(s,"activity.failed",message);
}

/** A pure reducer. The host persists command intents and delivers them after committing state. */
export function transition(definition:Definition,previous:RunState|null,event:Event):Decision {
  const problems=validateDefinition(definition);
  if(problems.length) throw new Error("invalid definition: "+problems.join("; "));
  const commands:Command[]=[];
  const diagnostics:string[]=[];
  if(!previous){
    if(event.type!=="start") throw new Error("first event must be start");
    const state:RunState={runId:event.runId,status:"running",input:event.input??{},position:null,visits:{},activations:0,nodes:{},streaks:{},from:null,invocation:null};
    enter(definition,state,definition.start,commands,diagnostics,null);
    return {state,commands,diagnostics};
  }
  const s:RunState=structuredClone(previous);
  if(["completed","failed","cancelled"].includes(s.status)){diagnostics.push("event.ignored-terminal");return {state:s,commands,diagnostics};}
  if(event.type==="start"){diagnostics.push("event.duplicate-start");return {state:s,commands,diagnostics};}
  if(event.type==="cancel"){
    if(s.invocation)commands.push({type:"cancel",invocationId:s.invocation.id});
    s.status="cancelled";s.position=null;s.invocation=null;diagnostics.push("run.cancel-requested");
    return {state:s,commands,diagnostics};
  }
  const nodeId=s.position;
  if(!nodeId){diagnostics.push("event.no-position");return {state:s,commands,diagnostics};}
  const node=definition.nodes[nodeId];
  if(event.type==="signal"){
    if(s.status!=="waiting"||node.kind!=="await-signal"||node.signal!==event.name||!(event.outcome in node.routes)){
      diagnostics.push("signal.unmatched");return {state:s,commands,diagnostics};
    }
    route(definition,s,nodeId,event.outcome,event.output??null,commands,diagnostics);
  }else if(event.type==="result"){
    const inv=s.invocation;
    if(!inv||s.status!=="running"||node.kind!=="activity"||event.invocationId!==inv.id){diagnostics.push("result.stale");return {state:s,commands,diagnostics};}
    const a=definition.actions?.[node.action] as ActionContract;
    if(event.status==="success"){
      const outcome=event.outcome??"ok";
      if(!a.outcomes.includes(outcome)){operationalFailure(definition,s,nodeId,"undeclared outcome: "+outcome,commands,diagnostics);}
      else{ s.invocation=null;route(definition,s,nodeId,outcome,event.output??null,commands,diagnostics); }
    }else if(event.status==="unknown"){
      if(a.effect!=="unsafe" && inv.attempt<(a.retry?.maxAttempts??1))invokeAgain(definition,s,commands);
      else{s.status="needs-intervention";diagnostics.push("invocation.unknown");}
    }else if(event.retryable && inv.attempt<(a.retry?.maxAttempts??1)){
      invokeAgain(definition,s,commands);
    }else{ s.invocation=null;operationalFailure(definition,s,nodeId,event.error??"action failed",commands,diagnostics); }
  }else if(event.type==="resolve"){
    const inv=s.invocation;
    if(s.status!=="needs-intervention"||!inv||event.invocationId!==inv.id||node.kind!=="activity"){
      diagnostics.push("resolution.not-applicable");return {state:s,commands,diagnostics};
    }
    if(event.action==="retry")invokeAgain(definition,s,commands);
    else if(event.action==="fail"){ s.invocation=null;operationalFailure(definition,s,nodeId,event.error??"resolved as failure",commands,diagnostics);}
    else{
      const o=event.outcome??"ok";
      if(!(definition.actions?.[node.action]?.outcomes??[]).includes(o))diagnostics.push("resolution.undeclared-outcome");
      else{s.invocation=null;route(definition,s,nodeId,o,event.output??null,commands,diagnostics);}
    }
  }
  return {state:s,commands,diagnostics};
}
