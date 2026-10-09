import {createHash} from 'node:crypto';
import {z} from 'zod';
import { mkdtemp, realpath, statfs } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve, isAbsolute, basename } from 'node:path';

// Keep the existing Bun test command and each test's deadline unchanged. Only
// the lifetime of the parent test process differs from the shared-process gate.
const cwd = await realpath(process.cwd());
const args=process.argv.slice(2);
if(args.includes('--help')){console.log('Usage: bun src/tooling/test-isolated.ts [--smol] [--files-from FILE | --resume RECEIPT_DIRECTORY] [--node-heap-mib 1024|1536] [--min-disk-mib MIB] [--min-swap-mib MIB]\nDefaults: 2048 MiB disk, 512 MiB swap. Fresh sequential processes preserve test deadlines. Incomplete runs exit 2 and retain resumable receipts.');process.exit(0);}
let smol=false,filesFrom:string|undefined,resume:string|undefined,heap:string|undefined,minDiskMiB=2048,minSwapMiB=512;
for(let i=0;i<args.length;i++){const arg=args[i];if(arg===undefined)throw Error('Missing runner argument');if(arg==='--smol')smol=true;else if(['--files-from','--resume','--node-heap-mib','--min-disk-mib','--min-swap-mib'].includes(arg)){const value=args[++i];if(!value)throw Error(`Missing value for ${arg}`);if(arg==='--files-from')filesFrom=value;else if(arg==='--resume')resume=value;else if(arg==='--node-heap-mib'){if(!['1024','1536'].includes(value))throw Error('Node heap must be 1024 or 1536 MiB');heap=value;}else{if(!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value)))throw Error(`Invalid ${arg}`);if(arg==='--min-disk-mib')minDiskMiB=Number(value);else minSwapMiB=Number(value);}}else throw Error(`Unknown option ${arg}`);}
const discovered=[...new Bun.Glob('**/*.{test,spec}.{ts,tsx}').scanSync({cwd,onlyFiles:true,dot:false})].filter(path=>!path.split('/').includes('node_modules')).sort();
async function validateFiles(values:unknown):Promise<string[]>{if(!Array.isArray(values)||!values.length||values.some(value=>typeof value!=='string'))throw Error('Test inventory must be a nonempty string array');const result:string[]=[];for(const value of values){if(typeof value!=='string'||isAbsolute(value)||value.includes('\\')||value.split('/').includes('..'))throw Error('Inventory must contain repository-relative test paths');const file=value.replace(/^\.\//,''),canonical=await realpath(resolve(cwd,file)),local=relative(cwd,canonical);if(local.startsWith('../')||isAbsolute(local)||!discovered.includes(file)||local!==file)throw Error(`Not a discovered repository test: ${file}`);if(result.includes(file))throw Error(`Duplicate inventory test: ${file}`);result.push(file);}return result;}
async function sha(value:string|Uint8Array){return createHash('sha256').update(value).digest('hex');}
let interrupted=false,ownedChild:ReturnType<typeof Bun.spawn>|undefined;
const auxiliaryChildren=new Set<ReturnType<typeof Bun.spawn>>();
const stop=()=>{interrupted=true;ownedChild?.kill('SIGTERM');for(const child of auxiliaryChildren)child.kill('SIGTERM');};process.on('SIGINT',stop);process.on('SIGTERM',stop);
async function managedOutput(command:string[]){if(interrupted)throw Error('Interrupted');const child=Bun.spawn(command,{cwd,stdout:'pipe',stderr:'pipe'});auxiliaryChildren.add(child);try{const [output,,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);if(code!==0||interrupted)throw Error('Repository fingerprint/resource probe unavailable');return output;}finally{auxiliaryChildren.delete(child);}}
const excluded=(file:string)=>file.split('/').some(part=>['node_modules','.git','dist','build','coverage','playwright-report','test-results','.wrangler','.cache','tmp'].includes(part))||/(^|\/)(AGENTS\.md|\.env(?:\..*)?|[^/]*\.(?:pem|key|p12|pfx)|[^/]*playwright[^/]*\.(?:png|jpg|webm|zip))$/i.test(file);
async function sourceFiles(){const tracked=(await managedOutput(['git','ls-files','-z'])).split('\0').filter(Boolean),untracked=(await managedOutput(['git','ls-files','--others','--exclude-standard','-z','--','src','tests','cli'])).split('\0').filter(Boolean);return [...new Set([...tracked,...untracked])].filter(file=>!excluded(file)).sort();}
async function fingerprint(){const hashes:Array<[string,string]>=[];for(const file of await sourceFiles()){if(interrupted)throw Error('Interrupted');const hash=createHash('sha256'),source=Bun.file(resolve(cwd,file));if(!await source.exists()){hashes.push([file,'missing']);continue;}const canonical=await realpath(resolve(cwd,file)),local=relative(cwd,canonical);if(local.startsWith('../')||isAbsolute(local))throw Error('Fingerprint input outside repository');const reader=source.stream().getReader();try{while(true){const chunk=await reader.read();if(chunk.done)break;hash.update(chunk.value);}}finally{reader.releaseLock();}hashes.push([file,hash.digest('hex')]);}return sha(JSON.stringify(hashes));}
const sourceFingerprint=await fingerprint();
const runBinding={sourceFingerprint,bunVersion:Bun.version,smol,nodeHeapMiB:heap??null,minDiskMiB,minSwapMiB};
const priorDirectory=resume?await realpath(resolve(resume)):undefined;
let inventory=discovered;
if(priorDirectory){if(!basename(priorDirectory).startsWith('flaregit-isolated-tests-'))throw Error('Resume directory is not an owned runner receipt directory');const previous:unknown=await Bun.file(join(priorDirectory,'inventory.json')).json();if(!previous||typeof previous!=='object'||!('cwd'in previous)||previous.cwd!==cwd||!('files'in previous))throw Error('Resume inventory repository mismatch');if(!('binding'in previous)||JSON.stringify(previous.binding)!==JSON.stringify(runBinding))throw Error('Resume source/runtime/options binding changed; start a fresh inventory run');inventory=await validateFiles(previous.files);}
if(filesFrom){if(resume)throw Error('Use either --files-from or --resume');inventory=await validateFiles((await Bun.file(filesFrom).text()).split(/\r?\n/).filter(line=>line.trim()).map(line=>line.trim()));}
const files=await validateFiles(inventory);
const directory=await mkdtemp(join(tmpdir(),'flaregit-isolated-tests-'));
await Bun.write(join(directory,'inventory.json'),JSON.stringify({cwd,files,binding:runBinding,resumedFrom:priorDirectory??null,smol,nodeHeapMiB:heap??null,minDiskMiB,minSwapMiB},null,2));
console.log(`Running ${files.length} files sequentially; receipts: ${directory}`);
async function resourceGate(){for(const path of [cwd,directory]){const disk=await statfs(path);if(disk.bavail*disk.bsize<minDiskMiB*1024*1024)return `Disk free below ${minDiskMiB} MiB at ${path}`;}if(process.platform==='darwin'){const output=await managedOutput(['/usr/sbin/sysctl','-n','vm.swapusage']);const free=/free\s*=\s*([\d.]+)M/.exec(output);if(!free)return 'Swap availability could not be verified';if(Number(free[1])<minSwapMiB)return `Swap free below ${minSwapMiB} MiB`;}else if(process.platform==='linux'){const info=await Bun.file('/proc/meminfo').text(),free=/^SwapFree:\s+(\d+) kB/m.exec(info),total=/^SwapTotal:\s+(\d+) kB/m.exec(info);if(!free||!total)return 'Swap availability could not be verified';if(Number(total[1])>0&&Number(free[1])<minSwapMiB*1024)return `Swap free below ${minSwapMiB} MiB`;}else return 'Swap preflight unsupported on this platform';return null;}


function summary(output: string) {
  // Failure output can contain a workerd child's summary as well as its parent.
  // Count only the final Bun summary for this launched test process.
  const clean = output.replace(/\u001b\[[0-9;]*m/g, '');
  const endings = [...clean.matchAll(/^Ran \d+ tests? across \d+ files?\..*$/gm)];
  const end = endings.at(-1);
  if (!end) return null;
  const preceding = clean.slice(0, end.index);
  const start = [...preceding.matchAll(/^\s*\d+ pass\s*$/gm)].at(-1);
  if (!start) return null;
  const before = preceding.slice(start.index);
  const count = (label: string) => Number([...before.matchAll(new RegExp(`^\\s*(\\d+) ${label}\\s*$`, 'gm'))].at(-1)?.[1] ?? 0);
  return { pass: count('pass'), fail: count('fail'), skip: count('skip'), errors: count('errors?'), line: end[0] };
}
async function streamLog(stream: ReadableStream<Uint8Array>, path: string) {
  const writer = Bun.file(path).writer(), reader = stream.getReader();
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      writer.write(chunk.value);
      await writer.flush();
    }
  } finally {
    reader.releaseLock();
    await writer.end();
  }
}
const results: Array<{ file: string; exitCode: number; stdoutLog: string; stderrLog: string; summary: ReturnType<typeof summary>; stdoutSha256?:string;stderrSha256?:string }> = [];
let failed = false,stopReason:string|null=null;
if(priorDirectory){const saved:unknown=await Bun.file(join(priorDirectory,'results.json')).json();if(!saved||typeof saved!=='object'||!('binding'in saved)||JSON.stringify(saved.binding)!==JSON.stringify(runBinding)||!('results'in saved)||!Array.isArray(saved.results))throw Error('Invalid resume receipts');for(const item of saved.results){if(!item||typeof item!=='object'||!('file'in item)||typeof item.file!=='string'||!files.includes(item.file))throw Error('Resume receipt outside original inventory');if('exitCode'in item&&item.exitCode===0&&'summary'in item&&item.summary&&typeof item.summary==='object'&&'fail'in item.summary&&item.summary.fail===0&&'errors'in item.summary&&item.summary.errors===0){const parsed=z.object({stdoutSha256:z.string().regex(/^[a-f0-9]{64}$/),stderrSha256:z.string().regex(/^[a-f0-9]{64}$/),file:z.string(),exitCode:z.number().int(),stdoutLog:z.string(),stderrLog:z.string(),summary:z.object({pass:z.number().int().nonnegative(),fail:z.literal(0),skip:z.number().int().nonnegative(),errors:z.literal(0),line:z.string()})}).parse(item);if(results.some(row=>row.file===parsed.file))throw Error('Duplicate resume receipt');for(const log of [parsed.stdoutLog,parsed.stderrLog]){const canonical=await realpath(log);if(relative(priorDirectory,canonical).startsWith('../')||relative(priorDirectory,canonical).includes('/'))throw Error('Resume log outside owned directory');}if(await sha(new Uint8Array(await Bun.file(parsed.stdoutLog).arrayBuffer()))!==parsed.stdoutSha256||await sha(new Uint8Array(await Bun.file(parsed.stderrLog).arrayBuffer()))!==parsed.stderrSha256)throw Error('Resume log hash mismatch');const loggedSummary=summary(await Bun.file(parsed.stderrLog).text())??summary(await Bun.file(parsed.stdoutLog).text());if(JSON.stringify(loggedSummary)!==JSON.stringify(parsed.summary))throw Error('Resume summary does not match hashed logs');const retainedPrefix=String(files.indexOf(parsed.file)+1).padStart(4,'0'),stdoutLog=join(directory,`${retainedPrefix}.stdout.log`),stderrLog=join(directory,`${retainedPrefix}.stderr.log`);await Bun.write(stdoutLog,Bun.file(parsed.stdoutLog));await Bun.write(stderrLog,Bun.file(parsed.stderrLog));results.push({...parsed,stdoutLog,stderrLog});}}}
for (const [index, file] of files.entries()) {
  if(results.some(row=>row.file===file))continue;
  if(interrupted){stopReason='Interrupted';break;}
  try{stopReason=await resourceGate();}catch(error){stopReason=`Resource preflight unavailable: ${error instanceof Error?error.message:'unknown failure'}`;}if(stopReason)break;
  const prefix = String(index + 1).padStart(4, '0');
  const stdoutLog = join(directory, `${prefix}.stdout.log`), stderrLog = join(directory, `${prefix}.stderr.log`);
  try {
    const child = Bun.spawn([process.execPath, ...(smol?['--smol']:[]), 'test', './' + file], { cwd, env: {...process.env,FLAREGIT_TEST_SMOL:smol?'1':process.env.FLAREGIT_TEST_SMOL,...(heap?{NODE_OPTIONS:`${process.env.NODE_OPTIONS??''} --max-old-space-size=${heap}`}:{})}, stdout: 'pipe', stderr: 'pipe' });
    ownedChild=child;
    console.log(`${prefix}/${files.length} running ${file}; logs: ${stdoutLog}, ${stderrLog}`);
    const [, , exitCode] = await Promise.all([streamLog(child.stdout, stdoutLog), streamLog(child.stderr, stderrLog), child.exited]);
    ownedChild=undefined;
    const [stdout, stderr] = await Promise.all([Bun.file(stdoutLog).text(), Bun.file(stderrLog).text()]);
    const counts = summary(stderr) ?? summary(stdout);
    results.push({ file, exitCode, stdoutLog, stderrLog, summary: counts,stdoutSha256:await sha(stdout),stderrSha256:await sha(stderr) });
    if (exitCode !== 0 || !counts || counts.fail > 0 || counts.errors > 0) failed = true;
    console.log(`${prefix}/${files.length} ${exitCode === 0 && counts && counts.fail === 0 && counts.errors === 0 ? 'finished' : 'failed'} ${file}${counts ? ` (${counts.pass} pass, ${counts.fail} fail, ${counts.skip} skip, ${counts.errors} errors)` : ' (Bun summary unavailable)'}`);
  } catch (error) {
    failed = true;
    const previous = await Bun.file(stderrLog).exists() ? await Bun.file(stderrLog).text() : '';
    await Bun.write(stderrLog, previous + '\n' + (error instanceof Error ? error.message : 'Test process launch failed'));
    results.push({ file, exitCode: -1, stdoutLog, stderrLog, summary: null,stdoutSha256:await Bun.file(stdoutLog).exists()?await sha(new Uint8Array(await Bun.file(stdoutLog).arrayBuffer())):undefined,stderrSha256:await sha(new Uint8Array(await Bun.file(stderrLog).arrayBuffer())) });
    console.log(`${prefix}/${files.length} failed ${file} (process unavailable; see log)`);
  }
  await Bun.write(join(directory, 'results.json'), JSON.stringify({ binding:runBinding,inventoryCount: files.length, attempted: results.length, results }, null, 2));
}
if(interrupted)stopReason='Interrupted';
try{if(await fingerprint()!==sourceFingerprint)stopReason='Source changed during the run; prior results cannot certify current code';}catch{stopReason=interrupted?'Interrupted':'Final source fingerprint unavailable';}
const complete=results.length===files.length&&!stopReason;
await Bun.write(join(directory,'remaining-files.txt'),files.filter(file=>!results.some(row=>row.file===file&&row.exitCode===0&&row.summary&&row.summary.fail===0&&row.summary.errors===0)).join('\n')+'\n');
await Bun.write(join(directory,'results.json'),JSON.stringify({binding:runBinding,inventoryCount:files.length,attempted:results.length,complete,stopReason,results},null,2));
process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);
const totals = results.reduce((sum, row) => {
  if (row.summary) for (const key of ['pass', 'fail', 'skip', 'errors'] as const) sum[key] += row.summary[key];
  return sum;
}, { pass: 0, fail: 0, skip: 0, errors: 0 });
await Bun.write(join(directory, 'summary.json'), JSON.stringify({ inventoryCount: files.length, attempted: results.length, failedFiles: results.filter(row => row.exitCode !== 0 || !row.summary || row.summary.fail || row.summary.errors).map(row => row.file), totals, failed, complete, stopReason, countScope: 'Final Bun summary of each fresh file process; nested child summaries are not added' }, null, 2));
console.log(`Attempted ${results.length}/${files.length} files; ${totals.pass} pass, ${totals.fail} fail, ${totals.skip} existing skips, ${totals.errors} errors. Receipts: ${directory}`);
if(stopReason)console.log(`Stopped incomplete: ${stopReason}; resume with --resume ${directory}`);
process.exitCode = !complete ? 2 : failed ? 1 : 0;
