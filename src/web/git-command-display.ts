/** Credential material is never included in displayed or copied shell commands. */
export function separateGitCommands(commands:string[],separateToken?:string):{commands:string[];token:string|null}{
 if(separateToken!==undefined&&(!/^[A-Za-z0-9_-]{1,4096}$/.test(separateToken)))throw Error('Git credential response could not be verified.');
 let token:string|null=separateToken??null;const clean=commands.map(command=>{
  const result=command.replace(/ -c http\.extraHeader="Authorization: Bearer ([A-Za-z0-9_-]+)"/g,(_match,value:string)=>{if(token&&token!==value)throw Error('Git credential response differs.');token=value;return '';});
  if(/Authorization|fgg_|https:\/\/[^/\s]*@/i.test(result))throw Error('Git command contains unsupported credential material.');return result;
 });if(clean.length>0&&!token)throw Error('Git credential was not returned. Request Git access again.');return {commands:clean,token};
}
