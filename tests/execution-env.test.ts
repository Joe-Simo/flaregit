import {expect,test} from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {spawnSync} from "node:child_process";
import {executionEnv} from "../src/core/verification/execution";

test("scrubbed commands find the exact supervisor Bun without inheriting toolcache PATH or credentials",()=>{
  const work=fs.mkdtempSync(path.join(os.tmpdir(),"flaregit-tools-")),home=path.join(work,"home");fs.mkdirSync(home);
  const previousPath=process.env.PATH,previousSecret=process.env.FLAREGIT_UNIT_CREDENTIAL;
  try{
    process.env.PATH="/untrusted/customer/bin";process.env.FLAREGIT_UNIT_CREDENTIAL="synthetic-only-secret";
    const env=executionEnv(home);expect(env.PATH).not.toContain("/untrusted/customer/bin");expect(env.FLAREGIT_UNIT_CREDENTIAL).toBeUndefined();
    const result=spawnSync("/bin/sh",["-c","bun --version"],{env,encoding:"utf8"});expect(result.status).toBe(0);expect(result.stdout.trim()).toBe(Bun.version);
    const bun=path.join(work,"supervisor-tools","bun");expect(fs.realpathSync(bun)).toBe(fs.realpathSync(process.execPath));expect(fs.readdirSync(path.dirname(bun))).toEqual(["bun"]);
    const runtimeDirectory=path.dirname(fs.realpathSync(process.execPath));
    if(!["/usr/local/bin","/usr/bin","/bin"].includes(runtimeDirectory))expect(env.PATH).not.toContain(runtimeDirectory);
  }finally{if(previousPath===undefined)delete process.env.PATH;else process.env.PATH=previousPath;if(previousSecret===undefined)delete process.env.FLAREGIT_UNIT_CREDENTIAL;else process.env.FLAREGIT_UNIT_CREDENTIAL=previousSecret;fs.rmSync(work,{recursive:true,force:true});}
});

test("an attacker-controlled tool directory is rejected",()=>{
  const work=fs.mkdtempSync(path.join(os.tmpdir(),"flaregit-tools-")),home=path.join(work,"home");fs.mkdirSync(home);fs.mkdirSync(path.join(work,"attacker"));fs.symlinkSync(path.join(work,"attacker"),path.join(work,"supervisor-tools"));
  try{expect(()=>executionEnv(home)).toThrow(/tool directory/);}finally{fs.rmSync(work,{recursive:true,force:true});}
});
