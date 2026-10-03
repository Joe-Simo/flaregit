import {expect,test} from "bun:test";
import {mkdtempSync,rmSync,existsSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {git,gitOrThrow,authArgs,PLATFORM_IDENTITY} from "../src/core/pipeline/git";
import {isolateTaskWorkspace} from "../src/core/pipeline/isolate";
import {LocalGitArtifactsClient} from "../src/artifacts/local-git";
const token="SYNTHETIC_CREDENTIAL_MARKER";
function fixture(){return mkdtempSync(join(tmpdir(),"flaregit-git-diagnostic-"));}
test("Git failures retain command diagnostics but omit explicit header credentials",()=>{
 const dir=fixture();try{
 let message="";try{gitOrThrow(dir,[...authArgs("https://example.invalid/repo.git",token),"definitely-not-a-git-command"]);}catch(error){message=(error as Error).message;}
 expect(message).toContain("definitely-not-a-git-command");expect(message).toContain("not a git command");expect(message).not.toContain(token);expect(message).not.toContain("extraHeader=");
 const result=git(dir,[...authArgs("https://example.invalid/repo.git",token),"-c","alias.safe-diagnostic=!printf 'fatal: preserved refusal %s\\n' \"$GIT_CONFIG_VALUE_0\" >&2; exit 1","safe-diagnostic"]);
 expect(result.ok).toBe(false);expect(result.stderr).toContain("fatal: preserved refusal");expect(result.stderr).not.toContain(token);expect(result.stderr).toContain("[REDACTED]");
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test("inherited Git tracing and config injection cannot leak a synthetic header",()=>{
 const dir=fixture(),keys=["GIT_TRACE","GIT_TRACE2_EVENT","GIT_CURL_VERBOSE","GIT_CONFIG_COUNT","GIT_CONFIG_KEY_0","GIT_CONFIG_VALUE_0"] as const,old=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
 try{process.env.GIT_TRACE=join(dir,"trace");process.env.GIT_TRACE2_EVENT=join(dir,"trace2");process.env.GIT_CURL_VERBOSE="1";process.env.GIT_CONFIG_COUNT="1";process.env.GIT_CONFIG_KEY_0="alias.injected";process.env.GIT_CONFIG_VALUE_0="!printf inherited";
 const result=git(dir,[...authArgs("https://example.invalid/repo.git",token),"not-a-command"]);expect(result.ok).toBe(false);expect(result.stderr).not.toContain(token);expect(existsSync(join(dir,"trace"))).toBe(false);expect(existsSync(join(dir,"trace2"))).toBe(false);expect(git(dir,["injected"]).ok).toBe(false);
 }finally{for(const key of keys){if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];}rmSync(dir,{recursive:true,force:true});}
});
test("authentication applies to the specified origin and rejects malformed credential fields",()=>{
 expect(authArgs("https://example.invalid/repo.git",token)[1]).toBe("http.https://example.invalid/.extraHeader=Authorization: Bearer "+token);
 expect(authArgs("/local/repository",token)).toEqual([]);
 expect(()=>authArgs("https://example.invalid/repo.git",token+"\nInjected: secret")).toThrow("Invalid Git credential");
 expect(()=>authArgs("https://user:secret@example.invalid/repo.git",token)).toThrow("must not contain credentials");
 const dir=fixture();try{let error="";try{gitOrThrow(dir,["not-a-command","https://user:SYNTHETIC_PASSWORD@example.invalid/repo.git"]);}catch(value){error=(value as Error).message;}expect(error).not.toContain("SYNTHETIC_PASSWORD");expect(error).toContain("[REDACTED]");}finally{rmSync(dir,{recursive:true,force:true});}
});
test("safe diagnostics do not redact successful repository content or discard Git failure flags",()=>{
 const dir=fixture();try{gitOrThrow(dir,["init","--quiet"]);writeFileSync(join(dir,"file"),token);gitOrThrow(dir,["add","file"]);gitOrThrow(dir,[...PLATFORM_IDENTITY,"commit","--quiet","-m","Synthetic content"]);expect(gitOrThrow(dir,["show","HEAD:file"])).toBe(token);const refusal=git(dir,["rev-parse","--verify","missing-ref"]);expect(refusal.ok).toBe(false);expect(refusal.stderr).toContain("Needed a single revision");}finally{rmSync(dir,{recursive:true,force:true});}
});
test("isolated workspace clone still checks out its exact local Git base",async()=>{
 const dir=fixture();try{const artifacts=new LocalGitArtifactsClient(join(dir,"artifacts")),canonical=await artifacts.create("canonical"),work=join(dir,"source");gitOrThrow(dir,["clone","--quiet",canonical.remote,work]);writeFileSync(join(work,"file"),"Saved base");gitOrThrow(work,["add","file"]);gitOrThrow(work,[...PLATFORM_IDENTITY,"commit","--quiet","-m","Base"]);gitOrThrow(work,["push","--quiet","origin","HEAD:main"]);const base=gitOrThrow(work,["rev-parse","HEAD"]);const task=await isolateTaskWorkspace(artifacts,{projectId:"synthetic",taskId:"one",goal:"Synthetic local Git isolation",contributorName:"Ada",contributorType:"human",canonicalRepoName:"canonical",baseCommit:base,workspacesDir:join(dir,"workspace")});expect(gitOrThrow(task.workspace.localPath!,["rev-parse","HEAD"])).toBe(base);expect(gitOrThrow(task.workspace.localPath!,["branch","--show-current"])).toBe("task/one");expect(gitOrThrow(task.workspace.localPath!,["config","user.name"])).toBe("Ada");}finally{rmSync(dir,{recursive:true,force:true});}
});

test("Git resolves the explicit credential only for its HTTPS origin",()=>{
 const dir=fixture();try{
 const args=authArgs("https://example.invalid/repo.git",token);
 const same=git(dir,[...args,"config","--get-urlmatch","http.extraHeader","https://example.invalid/nested/repo.git"]);
 expect(same.ok).toBe(true);expect(same.stdout.trim()).toBe("Authorization: Bearer "+token);
 for(const remote of ["https://other.invalid/repo.git","https://example.invalid.evil.invalid/repo.git","http://example.invalid/repo.git","https://example.invalid:8443/repo.git"]){
 const other=git(dir,[...args,"config","--get-urlmatch","http.extraHeader",remote]);expect(other.ok).toBe(false);expect(other.stdout).toBe("");expect(other.stderr).not.toContain(token);
 }
 }finally{rmSync(dir,{recursive:true,force:true});}
});
