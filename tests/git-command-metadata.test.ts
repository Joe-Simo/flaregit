import {expect,test} from "bun:test";
import {gitCloneCommand,taskGitCommands} from "../src/server/git-command-metadata";
const remote="https://flaregit.test/git/p123456789abc/tasks/agent-a-discount-197cc1b2-588c-4a7c-bd8a-731e21894ec1.git";
const taskId="agent-a-discount-197cc1b2-588c-4a7c-bd8a-731e21894ec1",branch=`task/${taskId}`,commit="a".repeat(40);
test("new, stacked and replay commands contain only operational Git identities",()=>{
 expect(gitCloneCommand(remote)).toBe(`git clone ${remote}`);expect(gitCloneCommand(remote,undefined,{branch:"codex/source"})).toBe(`git clone --branch codex/source ${remote}`);
 const fresh=taskGitCommands({remote,taskId,branch,commit,stacked:false,replayed:false});expect(fresh).toEqual([`git clone --no-checkout ${remote} ${taskId} && cd ${taskId}`,`git checkout -b ${branch} ${commit}   # edit, then commit`,`git push origin ${branch}`]);
 const stacked=taskGitCommands({remote,taskId,branch,commit,stacked:true,replayed:false});expect(stacked[1]).toContain(`git checkout --detach ${commit}`);
 const replay=taskGitCommands({remote,taskId,branch,commit,stacked:false,replayed:true});expect(replay[1]).toContain(`git checkout ${branch} || git checkout -b ${branch} ${commit}`);
 for(const commands of [fresh,stacked,replay])expect(commands.join("\n")).not.toMatch(/fgg_|Bearer|Authorization|extraHeader/);
});
test("command generation rejects credentials, shell input and unsafe saved branches",()=>{
 for(const invalid of ["https://user:secret@flaregit.test/repo.git",`${remote}?token=secret`,`${remote}#secret`,`${remote};echo-secret`,`${remote}\nsecret`])expect(()=>gitCloneCommand(invalid)).toThrow();
 for(const invalid of ["-bad","../bad","bad;echo-secret"]){expect(()=>gitCloneCommand(remote,invalid)).toThrow();expect(()=>taskGitCommands({remote,taskId,branch:invalid,commit,stacked:false,replayed:false})).toThrow();}
});

test("generated commands honor the saved branch and commit when remote HEAD points to missing main",async()=>{
 const {mkdtemp,rm}=await import("node:fs/promises"),{tmpdir}=await import("node:os"),{join}=await import("node:path");
 const directory=await mkdtemp(join(tmpdir(),"flaregit-command-branch-"));
 const run=async(argv:string[],cwd=directory)=>{const child=Bun.spawn(argv,{cwd,env:{...process.env,GIT_CONFIG_GLOBAL:"/dev/null",GIT_CONFIG_NOSYSTEM:"1",GIT_TERMINAL_PROMPT:"0"},stdout:"pipe",stderr:"pipe"});const [stdout,stderr,status]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);if(status!==0)throw new Error(`Native Git command failed: ${stderr}`);return stdout.trim();};
 const server=Bun.serve({hostname:"127.0.0.1",port:0,async fetch(request){const path=new URL(request.url).pathname;if(!path.startsWith("/remote.git/")||path.includes("..")||!/^[A-Za-z0-9/._-]+$/.test(path))return new Response("missing",{status:404});const file=Bun.file(join(directory,path));return await file.exists()?new Response(file):new Response("missing",{status:404});}});
 try{
  await run(["git","init","--bare","--initial-branch=main","remote.git"]);const tree=await run(["git","--git-dir=remote.git","mktree"]),saved=await run(["git","--git-dir=remote.git","-c","user.name=Fixture","-c","user.email=fixture@example.test","commit-tree",tree,"-m","Saved branch"]);
  await run(["git","--git-dir=remote.git","update-ref","refs/heads/codex/source",saved]);await run(["git","--git-dir=remote.git","update-server-info"]);
  const fixtureRemote=`${server.url.origin}/remote.git`,commands=taskGitCommands({remote:fixtureRemote,taskId:"saved-task",branch:"task/saved-task",commit:saved,stacked:false,replayed:false});
  await run(["sh","-c",commands[0]!]);await run(["sh","-c",commands[1]!],join(directory,"saved-task"));expect(await run(["git","rev-parse","HEAD"],join(directory,"saved-task"))).toBe(saved);expect(await run(["git","branch","--show-current"],join(directory,"saved-task"))).toBe("task/saved-task");
  await run(["sh","-c",gitCloneCommand(fixtureRemote,"canonical",{branch:"codex/source"})]);expect(await run(["git","branch","--show-current"],join(directory,"canonical"))).toBe("codex/source");expect(await run(["git","rev-parse","HEAD"],join(directory,"canonical"))).toBe(saved);
 }finally{server.stop(true);await rm(directory,{recursive:true,force:true});}
});

test("unborn contribution commands create an orphan without inventing a commit",()=>{const commands=taskGitCommands({remote,taskId,branch,commit:null,stacked:false,replayed:true});expect(commands[1]).toBe(`git checkout --orphan ${branch}   # create the first contribution commit`);expect(commands.join("\n")).not.toContain("null");expect(()=>taskGitCommands({remote,taskId,branch,commit:null,stacked:true,replayed:false})).toThrow("committed parent");});
