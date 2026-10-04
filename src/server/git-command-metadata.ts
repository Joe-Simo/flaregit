import {isSafeRef} from "../core/sanitize";
/** Only non-secret repository identities enter command generation. */
export function gitCloneCommand(remote:string,directory?:string,options:{branch?:string;noCheckout?:boolean}={}):string {
 const {branch,noCheckout}=options;
 const url=new URL(remote);
 if(!/^https?:$/.test(url.protocol)||url.username||url.password||url.search||url.hash||remote!==url.href||/[^A-Za-z0-9:/._-]/.test(remote)||directory!==undefined&&!/^[a-z0-9][a-z0-9-]{2,100}$/.test(directory))throw new Error("Invalid Git command identity");
 if(branch!==undefined&&!isSafeRef(branch))throw new Error("Invalid Git command identity");
 return `git clone${noCheckout?" --no-checkout":""}${branch?` --branch ${branch}`:""} ${remote}${directory?` ${directory} && cd ${directory}`:""}`;
}
export function taskGitCommands(input:{remote:string;taskId:string;branch:string;commit:string|null;stacked:boolean;replayed:boolean}):string[]{
 if(!isSafeRef(input.branch)||input.commit!==null&&!/^[a-f0-9]{40}$/.test(input.commit))throw new Error("Invalid Git command identity");
 if(input.commit===null){if(input.stacked)throw new Error("Stacked change requires a committed parent checkpoint");return [gitCloneCommand(input.remote,input.taskId,{noCheckout:true}),`git checkout --orphan ${input.branch}   # create the first contribution commit`,`git push origin ${input.branch}`];}
 return [gitCloneCommand(input.remote,input.taskId,{noCheckout:true}),...(input.replayed?[`git checkout ${input.branch} || git checkout -b ${input.branch} ${input.commit}   # resume the saved commit and branch`]:[...(input.stacked?[`git checkout --detach ${input.commit}   # stacked: start from the recorded parent checkpoint`]:[]),`git checkout -b ${input.branch} ${input.commit}   # edit, then commit`,`git push origin ${input.branch}`])];
}
