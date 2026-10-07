import{expect,test}from'bun:test';
import{projectHealthObservation,readHealthObservation}from'../src/web/health-observation';
import{repositoryInitializationProgress}from'../src/web/repository-initialization-progress';
test('missing stale and unauthorized observations do not manufacture component outages',async()=>{
 const now=Date.now(),components=['Git','Agents'].map(label=>({label,degradedNow:true,lastCheckAt:null}));
 expect(projectHealthObservation({degraded:['Git','Agents'],components},now)).toEqual({degraded:[],unknown:true});
 for(const lastCheckAt of [now-900001,now+1])expect(projectHealthObservation({components:[{label:'Git',degradedNow:true,lastCheckAt}]},now)).toEqual({degraded:[],unknown:true});
 expect(projectHealthObservation({degraded:['Git']})).toEqual({degraded:[],unknown:true});
 const denied=async()=>Response.json({components:[{label:'Git',degradedNow:true,lastCheckAt:now}]},{status:403});
 expect(await readHealthObservation(denied,new AbortController().signal)).toEqual({degraded:[],unknown:true});
});
test('fresh recorded failures remain visible alongside unknown observations',()=>{
 const now=Date.now();expect(projectHealthObservation({components:[{label:'Git',degradedNow:true,lastCheckAt:now},{label:'Queue',degradedNow:false,lastCheckAt:now},{label:'Agents',degradedNow:true,lastCheckAt:null}]},now)).toEqual({degraded:['Git'],unknown:true});
 expect(projectHealthObservation({components:[{label:'Git',degradedNow:false,lastCheckAt:now}]},now)).toEqual({degraded:[],unknown:false});
});
test('empty initialization describes unborn history while README initialization describes its first commit',()=>{
 expect(repositoryInitializationProgress('empty')).toContain('has no commits');expect(repositoryInitializationProgress('readme')).toContain('first committed');
});
