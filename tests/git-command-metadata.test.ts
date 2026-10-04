import {expect,test} from "bun:test";
import {gitCloneCommand,taskGitCommands} from "../src/server/git-command-metadata";
const remote="https://flaregit.test/git/p123456789abc/tasks/agent-a-discount-197cc1b2-588c-4a7c-bd8a-731e21894ec1.git";
const taskId="agent-a-discount-197cc1b2-588c-4a7c-bd8a-731e21894ec1",branch=`task/${taskId}`,commit="a".repeat(40);
test("new, stacked and replay commands contain only operational Git identities",()=>{
 expect(gitCloneCommand(remote)).toBe(`git clone ${remote}`);
 const fresh=taskGitCommands({remote,taskId,branch,commit,stacked:false,replayed:false});expect(fresh).toEqual([`git clone ${remote} ${taskId} && cd ${taskId}`,`git checkout -b ${branch}   # edit, then commit`,`git push origin ${branch}`]);
 const stacked=taskGitCommands({remote,taskId,branch,commit,stacked:true,replayed:false});expect(stacked[1]).toContain(`git checkout --detach ${commit}`);
 const replay=taskGitCommands({remote,taskId,branch,commit,stacked:false,replayed:true});expect(replay[1]).toContain(`git checkout ${branch} || git checkout -b ${branch} ${commit}`);
 for(const commands of [fresh,stacked,replay])expect(commands.join("\n")).not.toMatch(/fgg_|Bearer|Authorization|extraHeader/);
});
test("command generation rejects credentials, shell input and unsafe saved branches",()=>{
 for(const invalid of ["https://user:secret@flaregit.test/repo.git",`${remote}?token=secret`,`${remote}#secret`,`${remote};echo-secret`,`${remote}\nsecret`])expect(()=>gitCloneCommand(invalid)).toThrow();
 for(const invalid of ["-bad","../bad","bad;echo-secret"]){expect(()=>gitCloneCommand(remote,invalid)).toThrow();expect(()=>taskGitCommands({remote,taskId,branch:invalid,commit,stacked:false,replayed:false})).toThrow();}
});
