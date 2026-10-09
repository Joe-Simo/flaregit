import {expect,test} from 'bun:test';
import {discoverAccountRepositories} from '../src/server/account-repository-discovery';
import type {FlareGitProjectState} from '../src/core/types';
const id='p123456789abc';
const state={projectId:id,projectName:'Private team repository',kind:'repository',acceptedState:{acceptedAt:'2026-10-08T00:00:00Z'}} as FlareGitProjectState;
test('team-only repository discovery projects current names without materializing account references',async()=>{
 const registered:[]=[];const rows=await discoverAccountRepositories({userId:'reader',registered:async()=>registered,inherited:async()=>({ids:[id],epoch:'org:2'}),repository:()=>({repositoryDiscoverySnapshot:async()=>({project:{id,name:state.projectName,role:'member',kind:'repository',created_at:state.acceptedState.acceptedAt??''},authorityEpoch:'reader:1'}),assertRepositoryDiscovery:async()=>true}),authorize:async()=>{}});
 expect(rows).toEqual([{id,name:state.projectName,role:'member',kind:'repository',created_at:state.acceptedState.acceptedAt??''}]);expect(registered).toEqual([]);
});
test('canonical grant epoch withdrawal withholds names after async repository reads',async()=>{
 let revision=1;await expect(discoverAccountRepositories({userId:'reader',registered:async()=>[],inherited:async()=>({ids:[id],epoch:'org:'+revision}),repository:()=>({repositoryDiscoverySnapshot:async()=>{revision++;return{project:{id,name:state.projectName,role:'member',kind:'repository',created_at:''},authorityEpoch:'reader:1'};},assertRepositoryDiscovery:async()=>true}),authorize:async()=>{}})).rejects.toThrow('authority changed');
});
test('complete discovery inventory is bounded rather than silently truncated',async()=>{
 await expect(discoverAccountRepositories({userId:'reader',registered:async()=>[],inherited:async()=>({ids:Array.from({length:1001},(_,i)=>i.toString().padStart(12,'0')),epoch:'bounded'}),repository:()=>{throw Error('Must not read any repository');},authorize:async()=>{}})).rejects.toThrow('supported inventory');
});

test('direct membership withdrawal during a later repository probe withholds earlier private names',async()=>{
 const second='p999999999999';let readable=true;
 const rows=await discoverAccountRepositories({userId:'reader',registered:async()=>[],inherited:async()=>({ids:[id,second],epoch:'org:2'}),repository:repositoryId=>({repositoryDiscoverySnapshot:async()=>{if(repositoryId===second)readable=false;return{project:{id:repositoryId,name:repositoryId===id?'Withdrawn private name':'Other repository',role:'member',kind:'repository',created_at:''},authorityEpoch:repositoryId+':1'};},assertRepositoryDiscovery:async()=>repositoryId!==id||readable}),authorize:async()=>{}});
 expect(JSON.stringify(rows)).not.toContain('Withdrawn private name');
});
