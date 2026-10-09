import {expect,test} from "bun:test";
import {
  AgentRefusedError,
  AgentRunLedger,
  agentActionAllowed,
  createAgentEnvironment,
  hostAllowed,
} from "../src/core/agent-environment";
import type {AgentEnvironment,AgentEnvironmentRequest} from "../src/core/agent-environment";

const base:AgentEnvironmentRequest={
  id:"env-one",
  repository:"org/app",
  commit:"a".repeat(40),
  allowedTools:["read_file","run_tests"],
  network:"none",
  allowedHosts:[],
  secretsGranted:false,
  maxRuntimeSeconds:600,
  maxMemoryMb:1024,
};
const makeEnvironment=(overrides:Partial<AgentEnvironmentRequest>={})=>createAgentEnvironment({...base,...overrides});

test("creates a frozen environment with normalized exact hosts",()=>{
  const environment=makeEnvironment({network:"allowlist",allowedHosts:["Registry.NPMJS.org","registry.npmjs.org","10.0.0.5"],allowedTools:["fetch_url","read_file"]});
  expect(environment.allowedHosts).toEqual(["registry.npmjs.org","10.0.0.5"]);
  expect(environment.secretsGranted).toBe(false);
  expect(Object.isFrozen(environment)).toBe(true);
  expect(Object.isFrozen(environment.allowedHosts)).toBe(true);
  expect(Object.isFrozen(environment.allowedTools)).toBe(true);
});

test("refuses allowlists that are empty, wildcarded or not exact hosts",()=>{
  const refused:string[][]=[
    [],
    ["*"],
    ["*.npmjs.org"],
    ["registry.*"],
    ["registry.npmjs.org:443"],
    ["user@registry.npmjs.org"],
    ["https://registry.npmjs.org"],
    ["registry.npmjs.org/path"],
    ["[2001:db8::1]"],
  ];
  for(const allowedHosts of refused){
    expect(()=>makeEnvironment({network:"allowlist",allowedHosts})).toThrow(AgentRefusedError);
  }
});

test("refuses host lists when network access is none",()=>{
  expect(()=>makeEnvironment({network:"none",allowedHosts:["registry.npmjs.org"]})).toThrow(AgentRefusedError);
});

test("refuses any secret grant",()=>{
  expect(()=>makeEnvironment({secretsGranted:true})).toThrow(AgentRefusedError);
});

test("refuses tools outside the known list",()=>{
  for(const allowedTools of [["push"],["read_file","delete_repository"],["READ_FILE"]]){
    expect(()=>makeEnvironment({allowedTools})).toThrow(AgentRefusedError);
  }
});

test("refuses runtime and memory limits outside their ranges",()=>{
  for(const maxRuntimeSeconds of [0,3601,1.5,Number.NaN]){
    expect(()=>makeEnvironment({maxRuntimeSeconds})).toThrow(AgentRefusedError);
  }
  for(const maxMemoryMb of [63,8193,100.5]){
    expect(()=>makeEnvironment({maxMemoryMb})).toThrow(AgentRefusedError);
  }
  expect(makeEnvironment({maxRuntimeSeconds:1,maxMemoryMb:64}).maxRuntimeSeconds).toBe(1);
  expect(makeEnvironment({maxRuntimeSeconds:3600,maxMemoryMb:8192}).maxMemoryMb).toBe(8192);
});

test("refuses unknown network modes and malformed identity",()=>{
  expect(()=>makeEnvironment({network:"proxy" as never})).toThrow(AgentRefusedError);
  expect(()=>makeEnvironment({commit:"A".repeat(40)})).toThrow(AgentRefusedError);
  expect(()=>makeEnvironment({id:"env one"})).toThrow(AgentRefusedError);
  expect(()=>makeEnvironment({repository:""})).toThrow(AgentRefusedError);
});

test("hostAllowed matches exact hostnames only",()=>{
  const environment=makeEnvironment({network:"allowlist",allowedHosts:["registry.npmjs.org","example.com"],allowedTools:["fetch_url"]});
  expect(hostAllowed(environment,"registry.npmjs.org")).toBe(true);
  expect(hostAllowed(environment,"REGISTRY.npmjs.org")).toBe(true);
  expect(hostAllowed(environment,"cdn.registry.npmjs.org")).toBe(false);
  expect(hostAllowed(environment,"npmjs.org")).toBe(false);
  expect(hostAllowed(environment,"registry.npmjs.org.evil.example")).toBe(false);
  expect(hostAllowed(environment,"")).toBe(false);
});

test("hostAllowed refuses ports, userinfo, paths, wildcards and trailing dots",()=>{
  const environment=makeEnvironment({network:"allowlist",allowedHosts:["registry.npmjs.org"],allowedTools:["fetch_url"]});
  for(const host of ["registry.npmjs.org:443","user@registry.npmjs.org","registry.npmjs.org/x","registry.npmjs.org?x=1","registry.npmjs.org.","*.npmjs.org","registry.npmjs.org%2e"]){
    expect(hostAllowed(environment,host)).toBe(false);
  }
});

test("hostAllowed accepts IP literals only when listed exactly",()=>{
  const environment=makeEnvironment({network:"allowlist",allowedHosts:["10.0.0.5","2001:db8::1"],allowedTools:["fetch_url"]});
  expect(hostAllowed(environment,"10.0.0.5")).toBe(true);
  expect(hostAllowed(environment,"10.0.0.6")).toBe(false);
  expect(hostAllowed(environment,"2001:db8::1")).toBe(true);
  expect(hostAllowed(environment,"2001:db8::2")).toBe(false);
  expect(hostAllowed(environment,"[2001:db8::1]")).toBe(false);
  expect(hostAllowed(environment,"2001:db8::1:443")).toBe(false);
});

test("hostAllowed is closed when network is none",()=>{
  const environment=makeEnvironment({allowedTools:["fetch_url"]});
  expect(hostAllowed(environment,"registry.npmjs.org")).toBe(false);
});

test("agentActionAllowed requires a granted tool in the environment repository",()=>{
  const environment=makeEnvironment({allowedTools:["read_file","run_tests"]});
  expect(agentActionAllowed(environment,{tool:"read_file",repository:"org/app"})).toBe(true);
  expect(agentActionAllowed(environment,{tool:"write_file",repository:"org/app"})).toBe(false);
  expect(agentActionAllowed(environment,{tool:"read_file",repository:"org/other"})).toBe(false);
});

test("agentActionAllowed checks network actions against the host allowlist",()=>{
  const environment=makeEnvironment({network:"allowlist",allowedHosts:["registry.npmjs.org"],allowedTools:["read_file","install_dependencies"]});
  expect(agentActionAllowed(environment,{tool:"install_dependencies",repository:"org/app",host:"registry.npmjs.org"})).toBe(true);
  expect(agentActionAllowed(environment,{tool:"install_dependencies",repository:"org/app",host:"evil.example"})).toBe(false);
  expect(agentActionAllowed(environment,{tool:"install_dependencies",repository:"org/app"})).toBe(false);
  expect(agentActionAllowed(environment,{tool:"read_file",repository:"org/app",host:"evil.example"})).toBe(false);
  const closed=makeEnvironment({allowedTools:["install_dependencies"]});
  expect(agentActionAllowed(closed,{tool:"install_dependencies",repository:"org/app",host:"registry.npmjs.org"})).toBe(false);
});

test("a finished run keeps its first outcome",()=>{
  let now=1_000;
  const clock=()=>now;
  const ledger=new AgentRunLedger();
  expect(ledger.startRun(makeEnvironment(),"run-one",clock)).toMatchObject({status:"running",startedAt:1_000,endedAt:null});
  now=2_000;
  expect(ledger.finishRun("run-one","succeeded")).toMatchObject({status:"succeeded",endedAt:2_000});
  expect(()=>ledger.finishRun("run-one","failed")).toThrow(AgentRefusedError);
  expect(()=>ledger.finishRun("run-one","succeeded")).toThrow(AgentRefusedError);
  expect(ledger.getRun("run-one")?.status).toBe("succeeded");
  ledger.startRun(makeEnvironment(),"run-two",clock);
  expect(ledger.finishRun("run-two","cancelled").status).toBe("cancelled");
});

test("a run past its runtime limit is recorded as timed_out",()=>{
  let now=10_000;
  const clock=()=>now;
  const ledger=new AgentRunLedger();
  const environment=makeEnvironment({maxRuntimeSeconds:1});
  ledger.startRun(environment,"at-limit",clock);
  now=11_000;
  expect(ledger.finishRun("at-limit","succeeded").status).toBe("succeeded");
  ledger.startRun(environment,"late",clock);
  now=12_001;
  expect(ledger.finishRun("late","succeeded")).toMatchObject({status:"timed_out",endedAt:12_001});
});

test("reading an overdue running run records timed_out",()=>{
  let now=0;
  const clock=()=>now;
  const ledger=new AgentRunLedger();
  ledger.startRun(makeEnvironment({maxRuntimeSeconds:2}),"hung",clock);
  expect(ledger.getRun("hung")?.status).toBe("running");
  now=2_001;
  expect(ledger.getRun("hung")).toMatchObject({status:"timed_out",endedAt:2_001});
  expect(()=>ledger.finishRun("hung","succeeded")).toThrow(AgentRefusedError);
});

test("ledger refuses duplicate, unknown, invalid and hand-built runs",()=>{
  const ledger=new AgentRunLedger();
  const clock=()=>0;
  ledger.startRun(makeEnvironment(),"run-one",clock);
  expect(()=>ledger.startRun(makeEnvironment(),"run-one",clock)).toThrow(AgentRefusedError);
  expect(()=>ledger.finishRun("missing","succeeded")).toThrow(AgentRefusedError);
  expect(()=>ledger.finishRun("run-one","done" as never)).toThrow(AgentRefusedError);
  expect(()=>ledger.startRun(makeEnvironment(),"run-three",()=>Number.NaN)).toThrow(AgentRefusedError);
  expect(ledger.getRun("missing")).toBeUndefined();
  const handBuilt={...makeEnvironment(),secretsGranted:true} as unknown as AgentEnvironment;
  expect(()=>ledger.startRun(handBuilt,"run-two",clock)).toThrow(AgentRefusedError);
});
