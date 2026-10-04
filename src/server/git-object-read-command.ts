/** Platform-owned binary reader. Git interprets an object type and full SHA only;
 * no checkout paths, repository scripts, replacement objects or inherited Git credentials. */
export const READ_GIT_OBJECT=String.raw`
const [kind,hash,limit]=Bun.argv.slice(1),max=Number(limit);
if(!['commit','tree','blob'].includes(kind)||!/^[a-f0-9]{40}$/.test(hash)||!Number.isSafeInteger(max)||max<1||max>4194304)process.exit(1);
const proc=Bun.spawn(['/usr/bin/git','--no-replace-objects','--no-pager','-C','/workspace/integration','cat-file',kind,hash],{env:{PATH:'/usr/bin:/bin',HOME:'/tmp',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0',GIT_NO_REPLACE_OBJECTS:'1'},stdout:'pipe',stderr:'ignore'});
const reader=proc.stdout.getReader(),chunks=[];let total=0;
try{for(;;){const next=await reader.read();if(next.done)break;total+=next.value.byteLength;if(total>max){proc.kill();await reader.cancel();process.exit(1);}chunks.push(next.value);}if(await proc.exited!==0)process.exit(1);const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}await Bun.write(Bun.stdout,bytes);}catch{proc.kill();process.exit(1);}
`;
