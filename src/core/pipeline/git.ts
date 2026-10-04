import { spawnSync } from "node:child_process";
import { redactSecrets } from "../../agents/prompt.js";

export interface GitResult { ok: boolean; stdout: string; stderr: string }

function invocation(args: string[]) {
  const command: string[] = [], config: Array<{key:string;value:string}> = [], secrets: string[] = [];
  for (let index=0; index<args.length; index++) {
    const argument=args[index]!;
    const assignment=argument==="-c"?args[index+1]:argument.startsWith("-c")?argument.slice(2):undefined;
    const header=assignment?.match(/^(http(?:\..+)?\.extraHeader)=(.*)$/i);
    if(header){
      if(/[\r\n\0]/.test(header[2]!))throw new Error("Invalid Git HTTP header configuration");
      config.push({key:header[1]!,value:header[2]!});
      secrets.push(header[2]!);
      const authorization=header[2]!.match(/^Authorization:\s*(?:Bearer|Basic)\s+(.+)$/i);if(authorization)secrets.push(authorization[1]!);
      if(argument==="-c")index++;
    }else command.push(argument);
  }
  const env: Record<string,string|undefined>={...process.env};
  for(const key of Object.keys(env))if(/^GIT_TRACE/i.test(key)||/^GIT_CONFIG_(?:COUNT|KEY_\d+|VALUE_\d+|PARAMETERS)$/i.test(key)||["GIT_CURL_VERBOSE","GIT_ASKPASS","SSH_ASKPASS","GIT_DIR","GIT_WORK_TREE","GIT_COMMON_DIR"].includes(key))delete env[key];
  Object.assign(env,{GIT_TERMINAL_PROMPT:"0",GIT_CONFIG_NOSYSTEM:"1",GIT_CONFIG_SYSTEM:"/dev/null",GIT_CONFIG_GLOBAL:"/dev/null",GIT_CONFIG_COUNT:String(config.length)});
  config.forEach((entry,index)=>{env[`GIT_CONFIG_KEY_${index}`]=entry.key;env[`GIT_CONFIG_VALUE_${index}`]=entry.value;});
  const diagnostic=(value:string)=>redactSecrets(secrets.filter(Boolean).sort((a,b)=>b.length-a.length).reduce((text,secret)=>text.split(secret).join("[REDACTED]"),value).replace(/(https?:\/\/)[^\s/@]+:[^\s/@]*@/gi,"$1[REDACTED]@"));
  return {command,env,diagnostic};
}

/** Noninteractive Git: explicit header credentials stay out of argv and diagnostics. */
export function git(repoDir: string, args: string[], opts?: { gitDir?: boolean }): GitResult {
  const base = opts?.gitDir ? ["--git-dir", repoDir] : ["-C", repoDir];
  const prepared=invocation(args);
  const res = spawnSync("git", [...base, ...prepared.command], {encoding:"utf-8",env:prepared.env,maxBuffer:64*1024*1024});
  const stderr=prepared.diagnostic((res.stderr??"")+(res.error?`\nGit process could not run: ${res.error.message}`:""));
  return {ok:res.status===0,stdout:res.status===0?res.stdout??"":prepared.diagnostic(res.stdout??""),stderr};
}

export function gitOrThrow(repoDir: string, args: string[], opts?: { gitDir?: boolean }): string {
  const res=git(repoDir,args,opts);
  if(!res.ok){const prepared=invocation(args);throw new Error(`git ${prepared.diagnostic(prepared.command.join(" "))} failed: ${res.stderr.trim()}`);}
  return res.stdout.trim();
}

/** Bearer credentials apply only to the explicit HTTPS origin; git() moves them to its child environment. */
export function authArgs(remote: string, token?: string): string[] {
  if(!token||!/^https:\/\//.test(remote))return [];
  if(token.length>16384||/[\r\n\0]/.test(token))throw new Error("Invalid Git credential");
  let url:URL;try{url=new URL(remote);}catch{throw new Error("Invalid HTTPS Git remote");}
  if(url.username||url.password)throw new Error("HTTPS Git remote must not contain credentials");
  return ["-c",`http.${url.origin}/.extraHeader=Authorization: Bearer ${token}`];
}

export const PLATFORM_IDENTITY = ["-c","user.name=FlareGit Integrator","-c","user.email=integrator@flaregit.com"];
export function changedFiles(repoDir: string, from: string | null, to: string): string[] {
  const result=git(repoDir,from===null?["ls-tree","--name-only","-r","-z",to]:["diff","--name-only","-z",`${from}..${to}`]);
  if(!result.ok)throw new Error(`Could not inspect changed files: ${result.stderr.trim()}`);
  return result.stdout.split("\0").filter(Boolean);
}
