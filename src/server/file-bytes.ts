export const MAX_FILE_BYTES = 16 * 1024 * 1024;

/** Preserve binary output and reject bounded reads that exceeded the permitted asset size. */
export function fileBytes(output: { stdout: ArrayBuffer; exitCode: number }, path: string): Uint8Array {
  if (output.exitCode !== 0) throw new Error(`read ${path} failed`);
  if (output.stdout.byteLength > MAX_FILE_BYTES) throw new Error(`read ${path} exceeds the 16 MiB asset limit`);
  return new Uint8Array(output.stdout);
}
