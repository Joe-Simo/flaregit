/** Strict whitelists for every string that can reach a git command line, a ref, or an HTTP header. Reject, never repair. */

const REF = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;
const PUSH_OPTION = /^[A-Za-z0-9][A-Za-z0-9._=:/-]{0,99}$/;
const SHA = /^[0-9a-f]{7,40}$/;
const HEADER_VALUE = /^[\x20-\x7e]{0,1024}$/; // printable ASCII only: no CR, LF, NUL or other controls

/** Branch / ref names: alphanumerics plus . _ / -, none of git's forbidden sequences. */
export function isSafeRef(name: unknown): name is string {
  return typeof name === "string" && REF.test(name) && !name.includes("..") && !name.includes("//") && !name.endsWith("/") && !name.endsWith(".") && !name.endsWith(".lock") && !name.includes("/.") && !name.includes("@{");
}

/** `git push -o <value>`: a short key or key=value token. */
export function isSafePushOption(value: unknown): value is string {
  return typeof value === "string" && PUSH_OPTION.test(value);
}

/** A refspec is `[+]src:dst` where both sides are safe refs (or a hex commit on the left). */
export function isSafeRefspec(spec: unknown): spec is string {
  if (typeof spec !== "string") return false;
  const [src, dst, ...extra] = spec.replace(/^\+/, "").split(":");
  return extra.length === 0 && dst !== undefined && (isSafeRef(src) || SHA.test(src ?? "")) && isSafeRef(dst);
}

export const isSafeSha = (v: unknown): v is string => typeof v === "string" && SHA.test(v);

export function isSafeHeaderValue(v: unknown): v is string {
  return typeof v === "string" && HEADER_VALUE.test(v);
}

/** Shell-quote for the few places a command string is unavoidable. Callers must still whitelist first. */
export const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
