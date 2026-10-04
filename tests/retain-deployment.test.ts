import { nativeFunding } from "./support/native-funding.js";
import {expect,test} from "bun:test";
import {mkdtemp,rm,mkdir,chmod} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {retainDeploymentTarget} from "../src/server/retain-deployment";
import type {Env} from "../src/server/env";
test("native Git deployment pin readback preserves accepted objects and refuses a conflicting retained ref",async()=>{
  const root=await mkdtemp(join(tmpdir(),"flaregit-deploy-pin-")),canonical=join(root,"canonical.git"),seed=join(root,"seed");
  const git=async(args:string[])=>{const process=Bun.spawn(["git",...args],{stdout:"pipe",stderr:"pipe"});const[out,error,code]=await Promise.all([new Response(process.stdout).text(),new Response(process.stderr).text(),process.exited]);if(code!==0)throw new Error(error);return out.trim();};
  let tokenRevoked=0,destroyed=0,destroyConfirmed=true,lifetimeState:string|null="stopped";
  try{
    await git(["init","--bare","--initial-branch=main",canonical]);await git(["clone",canonical,seed]);await Bun.write(join(seed,"source.txt"),"accepted fixture\n");await git(["-C",seed,"add","."]);await git(["-C",seed,"-c","user.name=Unit","-c","user.email=unit@localhost","commit","-m","Accepted fixture"]);await git(["-C",seed,"push","origin","main"]);
    const commit=await git(["-C",seed,"rev-parse","HEAD"]),tree=await git(["-C",seed,"rev-parse","HEAD^{tree}"]);
    const hooks=join(root,"hooks"),marker=join(root,"unexpected-hook"),globalConfig=join(root,"global-git-config");
    await mkdir(hooks);await Bun.write(join(hooks,"pre-push"),`#!/bin/sh\ntouch '${marker}'\n`);await chmod(join(hooks,"pre-push"),0o700);await Bun.write(globalConfig,`[core]\n hooksPath = ${hooks}\n`);
    let invocation=0;
    const env={...nativeFunding(),ARTIFACTS:{get:async()=>({info:async()=>({remote:canonical}),createToken:async()=>({plaintext:"synthetic-only-token"}),revokeToken:async()=>{tokenRevoked++;return true;},[Symbol.dispose]:()=>{}})},INTEGRATOR:{getByName:()=>{const dir=join(root,`pin-${invocation++}`);return{exec:async(args:string[],options:{env?:Record<string,string>})=>{expect(Object.values(options.env??{})).not.toContain("Authorization: Bearer synthetic-only-token");expect(options.env?.GIT_CONFIG_KEY_1).toBe("http.followRedirects");expect(options.env?.GIT_CONFIG_VALUE_1).toBe("false");const process=Bun.spawn([args[0]!,args[1]!,args[2]!.replaceAll("/workspace/deployment-pin",dir)],{env:{...globalThis.process.env,GIT_CONFIG_GLOBAL:globalConfig,...options.env},stdout:"pipe",stderr:"pipe"});const[stdout,stderr,exitCode]=await Promise.all([new Response(process.stdout).text(),new Response(process.stderr).text(),process.exited]);return{success:exitCode===0,stdout,stderr,exitCode};},destroy:async()=>{destroyed++;if(!destroyConfirmed)throw new Error("Synthetic cleanup failure");},lifetimeStatus:async()=>lifetimeState ? {state:lifetimeState} : null};}}} as unknown as Env;
    const target={journalId:"journal",candidateId:"candidate",commit,tree,acceptedAt:new Date().toISOString(),recoverableRef:"refs/flaregit/deployments/journal"};
    await retainDeploymentTarget(env,"canonical",target,"test_account",`native-${crypto.randomUUID()}`);expect(await Bun.file(marker).exists()).toBe(false);expect(await git(["--git-dir",canonical,"rev-parse",target.recoverableRef])).toBe(commit);
    await retainDeploymentTarget(env,"canonical",target,"test_account",`native-${crypto.randomUUID()}`);expect(tokenRevoked).toBe(0);expect(destroyed).toBe(2);
    await Bun.write(join(seed,"source.txt"),"later accepted fixture\n");await git(["-C",seed,"add","."]);await git(["-C",seed,"-c","user.name=Unit","-c","user.email=unit@localhost","commit","-m","Later fixture"]);const later=await git(["-C",seed,"rev-parse","HEAD"]);await git(["-C",seed,"push","origin",`HEAD:${target.recoverableRef}`]);
    await expect(retainDeploymentTarget(env,"canonical",target,"test_account",`native-${crypto.randomUUID()}`)).rejects.toThrow(/different work/);expect(await git(["--git-dir",canonical,"rev-parse",target.recoverableRef])).toBe(later);expect(tokenRevoked).toBe(0);expect(destroyed).toBe(3);
    await git(["--git-dir",canonical,"update-ref",target.recoverableRef,commit]);
    const previousError=console.error;console.error=()=>{};
    try{
      for(const state of [null,"running","stopping","unknown"]){
        lifetimeState=state;
        await expect(retainDeploymentTarget(env,"canonical",target,"test_account",`native-${crypto.randomUUID()}`)).rejects.toThrow(/cleanup could not be confirmed/);
        expect(await git(["--git-dir",canonical,"rev-parse",target.recoverableRef])).toBe(commit);
      }
    }finally{console.error=previousError;lifetimeState="stopped";}
    destroyConfirmed=false;
    const originalError=console.error,messages:string[]=[];console.error=(...values:unknown[])=>{messages.push(values.map(String).join(" "));};
    try{await expect(retainDeploymentTarget(env,"canonical",target,"test_account",`native-${crypto.randomUUID()}`)).rejects.toThrow(/cleanup could not be confirmed/);expect(messages.join(" ")).not.toContain("synthetic-only-token");expect(messages.length).toBe(1);}finally{console.error=originalError;}

  }finally{await rm(root,{recursive:true,force:true});}
});

test.each(["http://invalid.example/repo.git","git@invalid.example:repo.git","relative/repo.git"])("invalid deployment remote refuses credentials and Git execution: %s",async(remote)=>{
 let minted=0,executed=0;
 const env={...nativeFunding(),ARTIFACTS:{get:async()=>({info:async()=>({remote}),createToken:async()=>{minted++;return{plaintext:"synthetic-token"};},[Symbol.dispose]:()=>{}})},INTEGRATOR:{getByName:()=>({exec:async()=>{executed++;return{success:true,stdout:"",stderr:"",exitCode:0};},destroy:async()=>{},lifetimeStatus:async()=>({state:"stopped"})})}} as unknown as Env;
 const target={journalId:"journal",candidateId:"candidate",commit:"a".repeat(40),tree:"b".repeat(40),acceptedAt:new Date().toISOString(),recoverableRef:"refs/flaregit/deployments/journal"};
 await expect(retainDeploymentTarget(env,"canonical",target,"fixture-account",`native-${crypto.randomUUID()}`)).rejects.toThrow(/HTTPS/);expect(minted).toBe(0);expect(executed).toBe(0);
});
