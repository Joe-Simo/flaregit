#!/usr/bin/env bun
/**
 * flaregit — scriptable CLI. Output is JSON by default (add --pretty for humans); errors go to stderr as
 * JSON with a non-zero exit code. No interactive prompts anywhere.
 */
import { isSafePushOption } from "../src/core/sanitize.js";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { structuredPatch } from "diff";

const CONFIG_DIR = path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"), "flaregit");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

interface Config { api?: string; token?: string }
const readConfig = (): Config => {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8")) as Config;
  } catch {
    return {};
  }
};

// ---- argument parsing: positional args plus --flag value / --flag ----
const argv = process.argv.slice(2);
const flags = new Map<string, string | true>();
const pos: string[] = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]!;
  if (a.startsWith("--")) {
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--") && !["pretty", "agent", "help"].includes(key)) {
      flags.set(key, next);
      i++;
    } else flags.set(key, true);
  } else pos.push(a);
}
const flag = (k: string): string | undefined => (typeof flags.get(k) === "string" ? (flags.get(k) as string) : undefined);
const pretty = flags.has("pretty");

const out = (data: unknown) => console.log(pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data));
const fail = (message: string, code = 1): never => {
  console.error(JSON.stringify({ error: message }));
  process.exit(code);
};

const cfg = readConfig();
const API = (process.env.FLAREGIT_API ?? cfg.api ?? "https://flaregit.com").replace(/\/$/, "");
const TOKEN = process.env.FLAREGIT_TOKEN ?? cfg.token;

async function api<T>(method: string, route: string, body?: unknown): Promise<T> {
  if (!TOKEN) fail("Not signed in. Create a token in the web app (Account → API tokens), then run: flaregit auth login <token>");
  const res = await fetch(`${API}/api${route}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  if (!res.ok) fail(text || `HTTP ${res.status}`, res.status === 401 ? 2 : 1);
  return (text ? JSON.parse(text) : {}) as T;
}

interface Project { id: string; name: string; role: string; kind: string }
async function resolveRepo(ref: string | undefined): Promise<string> {
  if (!ref) return fail("Specify a repository (name or id)");
  // A repository id is used as-is (the server checks membership), so repo-pinned tokens work without listing the account.
  if (/^p?[0-9a-f]{12}$/.test(ref)) return ref;
  if (/^[a-z0-9]{12,16}$/.test(ref) && !ref.includes("-")) {
    // could be an id or a short name: prefer an exact id match
    const { projects } = await api<{ projects: Project[] }>("GET", "/account");
    const byId = projects.find((p) => p.id === ref);
    if (byId) return byId.id;
    const byName = projects.filter((p) => p.name === ref);
    if (byName.length === 1) return byName[0]!.id;
    return fail(`No repository "${ref}"`);
  }
  const { projects } = await api<{ projects: Project[] }>("GET", "/account");
  const matches = projects.filter((p) => p.name === ref || p.id === ref);
  if (matches.length === 0) return fail(`No repository "${ref}"`);
  if (matches.length > 1) return fail(`"${ref}" is ambiguous; use the repository id`);
  return matches[0]!.id;
}

/** Credentials reach git through the environment of one command: never in argv, URLs or files. */
function git(args: string[], token?: string, cwd?: string) {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
  if (token) Object.assign(env, { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "http.extraHeader", GIT_CONFIG_VALUE_0: `Authorization: Bearer ${token}` });
  const r = spawnSync("git", args, { cwd, env, stdio: ["ignore", "pipe", "pipe"], encoding: "utf-8" });
  if (r.status !== 0) fail(`git ${args[0]} failed: ${(r.stderr || r.stdout).trim().slice(-400)}`);
  return r.stdout.trim();
}

const color = { red: (s: string) => `\x1b[31m${s}\x1b[0m`, green: (s: string) => `\x1b[32m${s}\x1b[0m`, cyan: (s: string) => `\x1b[36m${s}\x1b[0m`, bold: (s: string) => `\x1b[1m${s}\x1b[0m`, dim: (s: string) => `\x1b[2m${s}\x1b[0m` };

const HELP = `flaregit — JSON by default (--pretty for humans)

  auth login <token> | auth status | auth logout
  auth token [--scope read|write] [--ttl 1h] [--repo R]   mint a short-lived, narrower token
  repos
  repo import <url> --name N --test "cmd" [--install "cmd"] [--build "cmd"] [--branch B]
  repo demo [--name N]
  repo delete <repo> --confirm <name>
  changes <repo>
  change new <repo> "<goal>" [--agent]
  work <repo> "<goal>" [--dir D] [--on CHANGE] [--issue N]   create a change (stacked on CHANGE if given), clone it and check out its branch
  push                                   push the current change branch (fresh credential)
  ready <repo> <change> | cancel <repo> <change>
  integrate <repo> <changeA> <changeB>
  log <repo> [--limit N] | tree <repo> [path] | cat <repo> <path>
  issues <repo> [--state closed] | issue new <repo> "<title>" [--body T] | issue view|close|reopen <repo> <n>
  comment <repo> "<text>" (--issue N | --change ID | --candidate ID) [--path P --line N]
  candidates <repo> [--all]                      verified candidates waiting for review
  accept|reject <repo> <candidate> [--note T]    decide what becomes history
  diff <repo> (--change ID | --commit SHA)
  review <repo> (--change ID | --commit SHA)   interactive terminal reviewer (j/k n/p c a q)
  clone <repo> [dir] | activity <repo> | status
`;

async function main() {
  const [cmd, sub, ...rest] = pos;
  if (!cmd || flags.has("help")) return console.log(HELP);

  if (cmd === "auth" && sub === "token") {
    const scope = flag("scope") ?? "read";
    if (scope !== "read" && scope !== "write") fail("--scope must be read or write");
    const ttl = flag("ttl") ?? "1h";
    const m = /^(\d+)([mhd])$/.exec(ttl) ?? fail("--ttl looks like 30m, 1h or 1d (max 24h)");
    const ttlSeconds = Number(m[1]) * { m: 60, h: 3600, d: 86400 }[m[2] as "m" | "h" | "d"];
    const repoRef = flag("repo");
    const t = await api<{ token: string; scope: string; expiresAt: string | null }>("POST", "/tokens", { label: `cli ${scope} ${ttl}`, scope, ttlSeconds, ...(repoRef ? { repo: await resolveRepo(repoRef) } : {}) });
    return out({ token: t.token, scope: t.scope, expiresAt: t.expiresAt });
  }
  if (cmd === "auth") {
    if (sub === "login") {
      const token = rest[0] ?? fail("Usage: flaregit auth login <token>");
      if (!/^fgt_[0-9a-f]{12}_[A-Za-z0-9]{32,64}$/.test(token)) fail("That does not look like a FlareGit token (fgt_…)");
      const res = await fetch(`${API}/api/account`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) fail("Token rejected", 2);
      fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
      fs.writeFileSync(CONFIG_FILE, JSON.stringify({ api: API, token }), { mode: 0o600 });
      return out({ ok: true, api: API });
    }
    if (sub === "logout") {
      fs.rmSync(CONFIG_FILE, { force: true });
      return out({ ok: true });
    }
    const acct = await api<{ projects: unknown[]; plan: string; runsToday: number; runsPerDay: number }>("GET", "/account");
    return out({ signedIn: true, api: API, plan: acct.plan, runsToday: acct.runsToday, runsPerDay: acct.runsPerDay, repositories: acct.projects.length });
  }

  if (cmd === "status") return out(await (await fetch(`${API}/status.json`)).json());
  if (cmd === "repos") return out((await api<{ projects: Project[] }>("GET", "/account")).projects);

  if (cmd === "repo") {
    if (sub === "import") {
      const url = rest[0] ?? fail("Usage: flaregit repo import <url> --name N --test \"cmd\"");
      return out(await api("POST", "/projects", { kind: "import", url, name: flag("name") ?? url.split("/").pop(), test: flag("test") ?? fail("--test is required: the protected check every change must pass"), install: flag("install"), build: flag("build"), branch: flag("branch") }));
    }
    if (sub === "demo") return out(await api("POST", "/projects", { kind: "demo", name: flag("name") ?? "Ticket checkout" }));
    if (sub === "delete") {
      const id = await resolveRepo(rest[0]);
      const meta = await api<{ name: string }>("GET", `/p/${id}`);
      if (flag("confirm") !== meta.name) fail(`Pass --confirm "${meta.name}" to delete this repository permanently`);
      return out(await api("DELETE", `/p/${id}`));
    }
    return fail("Unknown repo command");
  }

  const repo = async (ref?: string) => resolveRepo(ref);

  if (cmd === "changes") {
    const id = await repo(sub);
    const state = await api<{ tasks: Record<string, { id: string; goal: string; status: string; contributor: { name: string }; createdAt: string }> }>("GET", `/p/${id}/state`);
    return out(Object.values(state.tasks).map((t) => ({ id: t.id, goal: t.goal, status: t.status, by: t.contributor.name, createdAt: t.createdAt })));
  }
  if (cmd === "change" && sub === "new") {
    const id = await repo(rest[0]);
    const goal = rest[1] ?? fail('Usage: flaregit change new <repo> "<goal>"');
    const taskId = `${goal.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "change"}-${Math.random().toString(36).slice(2, 6)}`;
    const created = await api<{ task: string; remote: string; branch: string; token: string }>("POST", `/p/${id}/tasks`, { taskId, goal });
    if (flags.has("agent")) await api("POST", `/p/${id}/tasks/${taskId}/agent`);
    return out({ change: created.task, branch: created.branch, agent: flags.has("agent"), note: flags.has("agent") ? "An AI agent is working on it" : `Run: flaregit work ${rest[0]} "${goal}"  (or push to ${created.branch})` });
  }
  if (cmd === "work") {
    const id = await repo(sub);
    const goal = rest[0] ?? fail('Usage: flaregit work <repo> "<goal>"');
    const taskId = `${goal.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "change"}-${Math.random().toString(36).slice(2, 6)}`;
    const on = flag("on");
    const created = await api<{ task: string; remote: string; branch: string; token: string }>("POST", `/p/${id}/tasks`, { taskId, goal, ...(on ? { dependsOn: on } : {}), ...(flag("issue") ? { issue: Number(flag("issue")) } : {}) });
    const dir = flag("dir") ?? taskId;
    git(["clone", "--quiet", created.remote, dir], created.token);
    if (on) git(["checkout", "--quiet", `task/${on}`], undefined, dir);
    git(["checkout", "--quiet", "-b", created.branch], undefined, dir);
    git(["config", "flaregit.repo", id], undefined, dir);
    git(["config", "flaregit.change", created.task], undefined, dir);
    return out({ change: created.task, branch: created.branch, dir: path.resolve(dir), next: "commit your work, then: flaregit push && flaregit ready <repo> " + created.task });
  }
  if (cmd === "push") {
    const id = git(["config", "flaregit.repo"]) || fail("Not inside a flaregit change checkout");
    const change = git(["config", "flaregit.change"]);
    const t = await api<{ remote: string; branch: string; token: string }>("POST", `/p/${id}/tasks/${change}/token`);
    const opts = (flags.get("option") === undefined ? [] : [String(flags.get("option"))]).map((o) => (isSafePushOption(o) ? o : fail(`Rejected push option "${o}": only letters, digits and . _ = : / - are allowed`)));
    git(["push", "--quiet", ...opts.flatMap((o) => ["-o", o]), t.remote, `HEAD:refs/heads/${t.branch}`], t.token);
    return out({ pushed: t.branch, change, next: `flaregit ready ${id} ${change}` });
  }
  if (cmd === "ready" || cmd === "cancel") return out(await api("POST", `/p/${await repo(sub)}/tasks/${rest[0] ?? fail("Specify a change id")}/${cmd}`));
  if (cmd === "issues") return out(await api("GET", `/p/${await repo(sub)}/issues?state=${flag("state") === "closed" ? "closed" : "open"}`));
  if (cmd === "issue") {
    const id = await repo(rest[0]);
    if (sub === "new") return out(await api("POST", `/p/${id}/issues`, { title: rest[1] ?? fail('Usage: flaregit issue new <repo> "<title>" [--body TEXT]'), body: flag("body") ?? "" }));
    if (sub === "view") return out(await api("GET", `/p/${id}/issues/${rest[1] ?? fail("Specify an issue number")}`));
    if (sub === "close" || sub === "reopen") return out(await api("PATCH", `/p/${id}/issues/${rest[1] ?? fail("Specify an issue number")}`, { state: sub === "close" ? "closed" : "open" }));
    fail("Usage: flaregit issue new|view|close|reopen <repo> ...");
  }
  if (cmd === "comment") {
    const subject = flag("issue") ? `issue:${flag("issue")}` : flag("change") ? `change:${flag("change")}` : flag("candidate") ? `candidate:${flag("candidate")}` : fail("Pass --issue N, --change ID or --candidate ID");
    const line = flag("line");
    return out(await api("POST", `/p/${await repo(sub)}/comments`, { subject, body: rest[0] ?? fail('Usage: flaregit comment <repo> "<text>" --change ID [--path P --line N]'), ...(flag("path") ? { path: flag("path") } : {}), ...(line ? { line: Number(line) } : {}) }));
  }
  if (cmd === "candidates") {
    const st = await api<{ candidates: Record<string, { id: string; status: string; candidateCommit?: string; participatingTaskIds: string[]; expectedAcceptedBase: string }> }>("GET", `/p/${await repo(sub)}/state`);
    return out(Object.values(st.candidates).filter((c) => flags.has("all") || c.status === "awaiting_review").map((c) => ({ id: c.id, status: c.status, commit: c.candidateCommit ?? null, base: c.expectedAcceptedBase, changes: c.participatingTaskIds })));
  }
  if (cmd === "accept" || cmd === "reject") {
    return out(await api("POST", `/p/${await repo(sub)}/candidates/${rest[0] ?? fail(`Usage: flaregit ${cmd} <repo> <candidate> [--note TEXT]`)}/review`, { approved: cmd === "accept", note: flag("note") ?? "" }));
  }
  if (cmd === "integrate") return out(await api("POST", `/p/${await repo(sub)}/integrations`, { taskIds: [rest[0], rest[1]] }));
  if (cmd === "activity") return out(await api("GET", `/p/${await repo(sub)}/activity`));
  if (cmd === "log") return out(await api("GET", `/p/${await repo(sub)}/commits?limit=${flag("limit") ?? 20}`));
  if (cmd === "tree") return out(await api("GET", `/p/${await repo(sub)}/tree?path=${encodeURIComponent(rest[0] ?? "")}`));
  if (cmd === "cat") {
    const r = await api<{ content: string; binary: boolean }>("GET", `/p/${await repo(sub)}/blob?path=${encodeURIComponent(rest[0] ?? fail("Specify a path"))}`);
    if (r.binary) fail("Binary file");
    process.stdout.write(r.content);
    return;
  }
  if (cmd === "clone") {
    const id = await repo(sub);
    const c = await api<{ remote: string; token: string }>("POST", `/p/${id}/clone`);
    const dir = rest[0] ?? id;
    git(["clone", "--quiet", c.remote, dir], c.token);
    return out({ cloned: path.resolve(dir), readOnly: true });
  }
  if (cmd === "diff") {
    const id = await repo(sub);
    const q = flag("change") ? `task=${flag("change")}` : flag("commit") ? `commit=${flag("commit")}` : fail("Pass --change ID or --commit SHA");
    const d = await api<{ files: Array<{ path: string; status: string; aHash?: string; bHash?: string }>; head: { hash: string } }>("GET", `/p/${id}/diff?${q}`);
    if (!pretty && !process.stdout.isTTY) return out(d);
    const blob = async (hash?: string) => (hash ? (await api<{ content: string }>("GET", `/p/${id}/blob-by-hash?hash=${hash}${flag("change") ? `&task=${flag("change")}` : ""}`)).content : "");
    for (const f of d.files) {
      console.log(color.bold(`${f.status.toUpperCase()}  ${f.path}`));
      const patch = structuredPatch(f.path, f.path, await blob(f.aHash), await blob(f.bHash), "", "", { context: 3 });
      for (const h of patch.hunks) {
        console.log(color.cyan(`@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`));
        for (const l of h.lines) console.log(l[0] === "+" ? color.green(l) : l[0] === "-" ? color.red(l) : l);
      }
    }
    return;
  }

  if (cmd === "review") {
    if (!process.stdin.isTTY || !process.stdout.isTTY) fail("review is interactive and needs a terminal; use `flaregit diff` for scripts");
    const id = await repo(sub);
    const change = flag("change");
    const q = change ? `task=${change}` : flag("commit") ? `commit=${flag("commit")}` : fail("Pass --change ID or --commit SHA");
    const d = await api<{ files: Array<{ path: string; status: string; aHash?: string; bHash?: string }> }>("GET", `/p/${id}/diff?${q}`);
    const blob = async (hash?: string) => (hash ? (await api<{ content: string; binary?: boolean }>("GET", `/p/${id}/blob-by-hash?hash=${hash}${change ? `&task=${change}` : ""}`)) : { content: "", binary: false });
    type Line = { text: string; hunk?: boolean; file?: number };
    const lines: Line[] = [];
    const fileStart: number[] = [];
    const collapsed = new Set<number>();
    const perFile: Line[][] = [];
    await Promise.all(
      d.files.map(async (f, i) => {
        const [a, b] = await Promise.all([blob(f.aHash), blob(f.bHash)]);
        const rows: Line[] = [{ text: color.bold(`${f.status.toUpperCase()}  ${f.path}`), file: i }];
        if (a.binary || b.binary) rows.push({ text: color.dim("  binary file not shown") });
        else {
          for (const h of structuredPatch(f.path, f.path, a.content, b.content, "", "", { context: 3 }).hunks) {
            rows.push({ text: color.cyan(`@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`), hunk: true });
            for (const l of h.lines) rows.push({ text: l[0] === "+" ? color.green(l) : l[0] === "-" ? color.red(l) : l });
          }
        }
        perFile[i] = rows;
      })
    );
    const rebuild = () => {
      lines.length = 0;
      fileStart.length = 0;
      perFile.forEach((rows, i) => {
        fileStart.push(lines.length);
        lines.push(...(collapsed.has(i) ? [rows[0]!] : rows));
      });
    };
    rebuild();
    let top = 0;
    let note = "";
    const term = process.stdout;
    const draw = () => {
      const h = term.rows - 1;
      term.write("\x1b[H\x1b[2J" + lines.slice(top, top + h).map((l) => l.text.slice(0, 400)).join("\n"));
      term.write(`\x1b[${term.rows};1H\x1b[7m ${d.files.length} files · j/k file  n/p hunk  c collapse  g/G ends  ${change ? "a mark ready  " : ""}q quit ${note}\x1b[0m`);
    };
    const clamp = () => { top = Math.max(0, Math.min(top, Math.max(0, lines.length - 1))); };
    const jump = (idxs: number[], dir: 1 | -1) => {
      const next = dir === 1 ? idxs.find((i) => i > top) : [...idxs].reverse().find((i) => i < top);
      if (next !== undefined) top = next;
    };
    term.write("\x1b[?1049h\x1b[?25l");
    process.stdin.setRawMode(true);
    process.stdin.resume();
    draw();
    await new Promise<void>((resolve) => {
      process.stdin.on("data", async (buf) => {
        const k = buf.toString();
        const page = term.rows - 2;
        note = "";
        if (k === "q" || k === "\u0003") return resolve();
        else if (k === "j") jump(fileStart, 1);
        else if (k === "k") jump(fileStart, -1);
        else if (k === "n") jump(lines.flatMap((l, i) => (l.hunk ? [i] : [])), 1);
        else if (k === "p") jump(lines.flatMap((l, i) => (l.hunk ? [i] : [])), -1);
        else if (k === " " || k === "\x1b[6~") top += page;
        else if (k === "b" || k === "\x1b[5~") top -= page;
        else if (k === "g") top = 0;
        else if (k === "G") top = lines.length - page;
        else if (k === "c") {
          const fi = fileStart.filter((s) => s <= top).length - 1;
          if (collapsed.has(fi)) collapsed.delete(fi); else collapsed.add(fi);
          rebuild();
          top = fileStart[fi] ?? 0;
        } else if (k === "a" && change) {
          try { await api("POST", `/p/${id}/tasks/${change}/ready`); note = "· marked ready"; } catch (e) { note = `· ${(e as Error).message}`; }
        }
        clamp();
        draw();
      });
    });
    term.write("\x1b[?25h\x1b[?1049l");
    process.stdin.setRawMode(false);
    process.stdin.pause();
    return;
  }

  fail(`Unknown command "${cmd}". Run flaregit --help`);
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
