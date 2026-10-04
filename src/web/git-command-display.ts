/** Credential material is never included in displayed or copied shell commands. */
export function separateGitCommands(commands:string[]):{commands:string[];token:string|null}{
 let token:string|null=null;const clean=commands.map(command=>{
  const result=command.replace(/ -c http\.extraHeader="Authorization: Bearer ([A-Za-z0-9_-]+)"/g,(_match,value:string)=>{if(token&&token!==value)throw Error('Git credential response differs.');token=value;return '';});
  if(/Authorization|fgg_|https:\/\/[^/\s]*@/i.test(result))throw Error('Git command contains unsupported credential material.');return result;
 });return {commands:clean,token};
}
