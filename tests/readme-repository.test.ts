import { expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { initializeReadmeGit, sealAndStopInitializer } from "../src/server/readme-repository";

test("README initialization creates attributed root history and refuses a racing existing branch", async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "flaregit-readme-test-"));
  try {
    const remote = path.join(work, "canonical.git");
    expect(spawnSync("git", ["init", "--bare", "--quiet", remote]).status).toBe(0);
    const executor = (directory: string) => ({ async exec(command: string, environment?: Record<string, string>) { const result = spawnSync("sh", ["-c", command.replaceAll("/workspace/readme-init", directory)], { encoding: "utf8", env: { ...process.env, ...environment } }); return { success: result.status === 0, stdout: result.stdout }; } });
    const input = { name: "Owner's project", description: "An original repository", authorName: "Repository Owner", authorEmail: "owner@users.noreply.flaregit.com", defaultBranch: "main", commitTimestamp: "2026-10-04T00:00:00Z" };
    const receipt = await initializeReadmeGit(executor(path.join(work, "first")), input, remote, "synthetic-unused-local-token", async () => {}, async () => {}, async () => true, async () => {});
    expect(spawnSync("git", ["--git-dir", remote, "show", `${receipt.head}:README.md`], { encoding: "utf8" }).stdout).toBe("# Owner's project\n\nAn original repository\n");
    expect(spawnSync("git", ["--git-dir", remote, "show", "-s", "--format=%an|%ae|%P", receipt.head], { encoding: "utf8" }).stdout.trim()).toBe("Repository Owner|owner@users.noreply.flaregit.com|");
    await expect(initializeReadmeGit(executor(path.join(work, "racer")), { ...input, description: "Different initial content" }, remote, "synthetic-unused-local-token", async () => {}, async () => {}, async () => true, async () => {})).rejects.toThrow("not confirmed");
    expect(spawnSync("git", ["--git-dir", remote, "rev-parse", "refs/heads/main"], { encoding: "utf8" }).stdout.trim()).toBe(receipt.head);
  } finally { fs.rmSync(work, { recursive: true, force: true }); }
});

test("lost push acknowledgment reads back the original recorded root without another write", async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "flaregit-readme-ack-"));
  try {
    const remote=path.join(work,"canonical.git"),directory=path.join(work,"initial"),events:string[]=[];
    spawnSync("git",["init","--bare","--quiet",remote]);
    let frozen="",pushes=0;
    const receipt=await initializeReadmeGit({async exec(command,environment){
      const result=spawnSync("sh",["-c",command.replaceAll("/workspace/readme-init",directory)],{encoding:"utf8",env:{...process.env,...environment}});
      if(command.includes(" push ")){pushes++;expect(events).toEqual(["recorded","push-intent"]);expect(result.status).toBe(0);return{success:false,stdout:""};}
      return{success:result.status===0,stdout:result.stdout};
    }},{name:"Original project",description:"",authorName:"Owner",authorEmail:"owner@users.noreply.flaregit.com",defaultBranch:"main",commitTimestamp:"2026-10-04T00:00:00Z"},remote,"synthetic-local-token",async()=>{},async value=>{frozen=value.head;events.push("recorded");},async()=>{events.push("push-intent");return true;},async value=>{expect(value.head).toBe(frozen);events.push("published");});
    expect(pushes).toBe(1);expect(receipt.head).toBe(frozen);expect(events).toEqual(["recorded","push-intent","published"]);
    expect(spawnSync("git",["--git-dir",remote,"show","-s","--format=%aI|%cI",receipt.head],{encoding:"utf8"}).stdout.trim().split("|").map(value=>Date.parse(value))).toEqual([Date.parse("2026-10-04T00:00:00Z"),Date.parse("2026-10-04T00:00:00Z")]);
  }finally{fs.rmSync(work,{recursive:true,force:true});}
});

test("initializer closure requires sealing before destruction and positive sealed stopped state",async()=>{
  for(const status of [{state:"stopped",sealed:true},{state:"stopped",sealed:false},{state:"running",sealed:true},null]){
    const calls:string[]=[];
    const closed=await sealAndStopInitializer({seal:async()=>{calls.push("seal");},destroy:async()=>{calls.push("destroy");},lifetimeStatus:async()=>{calls.push("inspect");return status;}});
    expect(calls).toEqual(["seal","destroy","inspect"]);expect(closed).toBe(status?.state==="stopped"&&status.sealed===true);
  }
});
