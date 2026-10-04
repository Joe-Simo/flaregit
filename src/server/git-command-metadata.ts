import {isSafeRef} from "../core/sanitize";
/** Only non-secret repository identities enter command generation. */
export function gitCloneCommand(remote:string,directory?:string):string {
 const url=new URL(remote);
 if(!/^https?:$/.test(url.protocol)||url.username||url.password||url.search||url.hash||remote!==url.href||/[^A-Za-z0-9:/._-]/.test(remote)||directory!==undefined&&!/^[a-z0-9][a-z0-9-]{2,100}$/.test(directory))throw new Error("Invalid Git command identity");
 return `git clone ${remote}${directory?` ${directory} && cd ${directory}`:""}`;
}
export function taskGitCommands(input:{remote:string;taskId:string;branch:string;commit:string;stacked:boolean;replayed:boolean}):string[]{
 if(!isSafeRef(input.branch)||!/^[a-f0-9]{40}$/.test(input.commit))throw new Error("Invalid Git command identity");
 return [gitCloneCommand(input.remote,input.taskId),...(input.replayed?[`git checkout ${input.branch} || git checkout -b ${input.branch} ${input.commit}   # resume the saved commit and branch`]:[...(input.stacked?[`git checkout --detach ${input.commit}   # stacked: start from the recorded parent checkpoint`]:[]),`git checkout -b ${input.branch}   # edit, then commit`,`git push origin ${input.branch}`])];
}
