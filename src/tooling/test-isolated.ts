import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Keep the existing Bun test command and each test's deadline unchanged. Only
// the lifetime of the parent test process differs from the shared-process gate.
const cwd = process.cwd();
const files = [...new Bun.Glob('**/*.test.{ts,tsx}').scanSync({ cwd, onlyFiles: true, dot: false })]
  .filter(path => !path.split('/').includes('node_modules'))
  .sort();
if (files.length === 0) throw new Error('No repository test files discovered');
const directory = await mkdtemp(join(tmpdir(), 'flaregit-isolated-tests-'));
await Bun.write(join(directory, 'inventory.json'), JSON.stringify({ cwd, files }, null, 2));
console.log(`Running ${files.length} files sequentially; receipts: ${directory}`);

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
const results: Array<{ file: string; exitCode: number; stdoutLog: string; stderrLog: string; summary: ReturnType<typeof summary> }> = [];
let failed = false;
for (const [index, file] of files.entries()) {
  const prefix = String(index + 1).padStart(4, '0');
  const stdoutLog = join(directory, `${prefix}.stdout.log`), stderrLog = join(directory, `${prefix}.stderr.log`);
  try {
    const child = Bun.spawn([process.execPath, 'test', './' + file], { cwd, env: process.env, stdout: 'pipe', stderr: 'pipe' });
    console.log(`${prefix}/${files.length} running ${file}; logs: ${stdoutLog}, ${stderrLog}`);
    const [, , exitCode] = await Promise.all([streamLog(child.stdout, stdoutLog), streamLog(child.stderr, stderrLog), child.exited]);
    const [stdout, stderr] = await Promise.all([Bun.file(stdoutLog).text(), Bun.file(stderrLog).text()]);
    const counts = summary(stderr) ?? summary(stdout);
    results.push({ file, exitCode, stdoutLog, stderrLog, summary: counts });
    if (exitCode !== 0 || !counts || counts.fail > 0 || counts.errors > 0) failed = true;
    console.log(`${prefix}/${files.length} ${exitCode === 0 && counts && counts.fail === 0 && counts.errors === 0 ? 'finished' : 'failed'} ${file}${counts ? ` (${counts.pass} pass, ${counts.fail} fail, ${counts.skip} skip, ${counts.errors} errors)` : ' (Bun summary unavailable)'}`);
  } catch (error) {
    failed = true;
    const previous = await Bun.file(stderrLog).exists() ? await Bun.file(stderrLog).text() : '';
    await Bun.write(stderrLog, previous + '\n' + (error instanceof Error ? error.message : 'Test process launch failed'));
    results.push({ file, exitCode: -1, stdoutLog, stderrLog, summary: null });
    console.log(`${prefix}/${files.length} failed ${file} (process unavailable; see log)`);
  }
  await Bun.write(join(directory, 'results.json'), JSON.stringify({ inventoryCount: files.length, attempted: results.length, results }, null, 2));
}
const totals = results.reduce((sum, row) => {
  if (row.summary) for (const key of ['pass', 'fail', 'skip', 'errors'] as const) sum[key] += row.summary[key];
  return sum;
}, { pass: 0, fail: 0, skip: 0, errors: 0 });
await Bun.write(join(directory, 'summary.json'), JSON.stringify({ inventoryCount: files.length, attempted: results.length, failedFiles: results.filter(row => row.exitCode !== 0 || !row.summary || row.summary.fail || row.summary.errors).map(row => row.file), totals, failed, countScope: 'Final Bun summary of each fresh file process; nested child summaries are not added' }, null, 2));
console.log(`Attempted ${results.length}/${files.length} files; ${totals.pass} pass, ${totals.fail} fail, ${totals.skip} existing skips, ${totals.errors} errors. Receipts: ${directory}`);
process.exitCode = failed ? 1 : 0;
