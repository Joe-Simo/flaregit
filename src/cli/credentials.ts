import * as fs from "node:fs";
import * as path from "node:path";

export function credentialOrigin(value: string): string {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("FLAREGIT_API must be an origin without credentials, path, query or fragment");
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) throw new Error("FLAREGIT_API requires HTTPS (HTTP is allowed only for local loopback)");
  return url.origin;
}

/** Replace credentials atomically; an older permissive file must not retain its mode. */
export function saveCredentials(file: string, config: { api: string; token: string }): void {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const temporary = path.join(dir, `.credentials-${crypto.randomUUID()}`);
  try {
    fs.writeFileSync(temporary, JSON.stringify(config), { mode: 0o600, flag: "wx" });
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}
