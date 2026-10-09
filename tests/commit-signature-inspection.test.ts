import {test,expect} from 'bun:test';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {gitOrThrow,PLATFORM_IDENTITY} from '../src/core/pipeline/git';
import {parseTrustedKey} from '../src/core/trusted-keys';
import {inspectCommitSignature,readCommitSignatureObject,commitSignatureRequest} from '../src/server/commit-signature-inspection';
import type {BranchGitExecutor} from '../src/server/branch-git';
const hash=async(bytes:Uint8Array)=>{const prefix=new TextEncoder().encode(`commit ${bytes.length}\0`),object=new Uint8Array(prefix.length+bytes.length);object.set(prefix);object.set(bytes,prefix.length);return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-1',object)),byte=>byte.toString(16).padStart(2,'0')).join('');};
const run=async(command:string[],cwd:string)=>{const child=Bun.spawn(command,{cwd,stdout:'pipe',stderr:'pipe'});const [stdout,stderr,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);if(code!==0)throw Error(`Git signature fixture failed: ${stderr}`);return stdout.trim();};

test('stock Git signed commit verifies exact raw bytes, legacy encoding and viewer key removal',async()=>{
 const root=await mkdtemp(join(tmpdir(),'flaregit-signature-'));
 try{
  await run(['ssh-keygen','-q','-t','ed25519','-N','','-f',join(root,'key')],root);
  const parsed=parseTrustedKey((await Bun.file(join(root,'key.pub')).text()).trim());if(!parsed.ok)throw Error(parsed.error);const keys={ssh:parsed.keys,gpg:[]};
  gitOrThrow(root,['init','-b','main']);await Bun.write(join(root,'README.md'),'Signature source\n');gitOrThrow(root,['add','.']);gitOrThrow(root,[...PLATFORM_IDENTITY,'-c','gpg.format=ssh','-c',`user.signingKey=${join(root,'key')}`,'-c','commit.gpgsign=true','commit','-m','Signed source']);
  const commit=gitOrThrow(root,['rev-parse','HEAD']),rawProcess=Bun.spawn(['git','cat-file','commit',commit],{cwd:root,stdout:'pipe',stderr:'pipe'}),raw=new Uint8Array(await new Response(rawProcess.stdout).arrayBuffer());expect(await rawProcess.exited).toBe(0);
  expect(await inspectCommitSignature(commit,raw,keys)).toMatchObject({commit,status:'verified',format:'ssh',trust:'viewer-registered-keys',fingerprint:expect.stringMatching(/^SHA256:/)});
  expect(await inspectCommitSignature(commit,raw,{ssh:[],gpg:[]})).toMatchObject({status:'unverified',reason:'No trusted SSH keys are registered'});
  const tampered=raw.slice();tampered[tampered.length-2]=tampered[tampered.length-2]!^1;await expect(inspectCommitSignature(commit,tampered,keys)).rejects.toThrow('hash differs');
  expect(await inspectCommitSignature(await hash(tampered),tampered,keys)).toMatchObject({status:'unverified'});
  const tree=gitOrThrow(root,['rev-parse','HEAD^{tree}']),prefix=new TextEncoder().encode(`tree ${tree}\nauthor Legacy <legacy@example.test> 1700000000 +0000\ncommitter Legacy <legacy@example.test> 1700000000 +0000\nencoding ISO-8859-1\n\nLegacy `),payload=new Uint8Array(prefix.length+2);payload.set(prefix);payload.set([0xff,10],prefix.length);
  await Bun.write(join(root,'payload'),payload);await run(['ssh-keygen','-Y','sign','-f',join(root,'key'),'-n','git',join(root,'payload')],root);
  const signature=(await Bun.file(join(root,'payload.sig')).text()).trimEnd(),separator=payload.indexOf(10,payload.indexOf(10)+1);expect(separator).toBeGreaterThan(0);
  const headerEnd=Buffer.from(payload).indexOf('\n\n'),signatureHeader=new TextEncoder().encode('\ngpgsig '+signature.replaceAll('\n','\n ')),signed=new Uint8Array(payload.length+signatureHeader.length);signed.set(payload.slice(0,headerEnd));signed.set(signatureHeader,headerEnd);signed.set(payload.slice(headerEnd),headerEnd+signatureHeader.length);
  expect(await inspectCommitSignature(await hash(signed),signed,keys)).toMatchObject({status:'verified',format:'ssh'});
 }finally{await rm(root,{recursive:true,force:true});}
},30000);

test('native signature reader uses bare stock Git, exact ancestry and bounded raw objects',async()=>{
 const root=await mkdtemp(join(tmpdir(),'flaregit-signature-read-')),seed=join(root,'seed'),fork=join(root,'fork.git'),operationId=crypto.randomUUID(),directory=`/workspace/signature-${operationId}`,mappedDirectory=join(root,'inspection'),remote=`https://${'a'.repeat(32)}.artifacts.cloudflare.net/signature.git`;
 try{
  await mkdir(seed);gitOrThrow(seed,['init','-b','main']);await Bun.write(join(seed,'source.txt'),'Source\n');gitOrThrow(seed,['add','.']);gitOrThrow(seed,[...PLATFORM_IDENTITY,'commit','-m','Unsigned source']);const commit=gitOrThrow(seed,['rev-parse','HEAD']);gitOrThrow(root,['clone','--bare',seed,fork]);
  const commands:string[]=[],executor:BranchGitExecutor={async beforeCommand(){},async exec(command,env){commands.push(command);const mapped=command.replaceAll(remote,fork).replaceAll(directory,mappedDirectory).replace(/\/workspace\/signature-[a-f0-9-]+/g,mappedDirectory).replaceAll('/usr/local/bin/bun',process.execPath);const child=Bun.spawn(['sh','-c',mapped],{env:{...Bun.env,...env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_COUNT:'3',GIT_CONFIG_KEY_1:'core.hooksPath',GIT_CONFIG_VALUE_1:'/dev/null',GIT_CONFIG_KEY_2:'http.followRedirects',GIT_CONFIG_VALUE_2:'false'},stdout:'pipe',stderr:'pipe'});const [stdout,stderr,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);if(code!==0)return{success:false,stdout:stderr};return{success:true,stdout};}};
  const bytes=await readCommitSignatureObject(executor,{remote,token:'fixture-never-in-command',anchor:commit,commit,operationId});expect(await inspectCommitSignature(commit,bytes,{ssh:[],gpg:[]})).toMatchObject({status:'unsigned'});expect(commands.every(command=>!command.includes('fixture-never-in-command')&&!/(?:^|[;&])\s*git[^;\n]*\s(?:checkout|push)(?:\s|$)/.test(command))).toBe(true);
  const blob=gitOrThrow(seed,['rev-parse','HEAD:source.txt']);await expect(readCommitSignatureObject(executor,{remote,token:'fixture-never-in-command',anchor:commit,commit:blob,operationId:crypto.randomUUID()})).rejects.toThrow('unavailable');
 }finally{await rm(root,{recursive:true,force:true});}
},30000);

test('signature requests reject ambiguous review scopes and unknown or abbreviated commit queries',()=>{
 for(const value of [{commit:'a'.repeat(7)},{commit:'a'.repeat(40),task:'x',candidate:'y'},{commit:'a'.repeat(40),input:'x'},{commit:'a'.repeat(40),extra:true}])expect(commitSignatureRequest.safeParse(value).success).toBe(false);
 expect(commitSignatureRequest.safeParse({commit:'a'.repeat(40),candidate:'y',input:'x'}).success).toBe(true);
 expect(commitSignatureRequest.safeParse({commit:'a'.repeat(40),task:'a'.repeat(101)}).success).toBe(true);
});
