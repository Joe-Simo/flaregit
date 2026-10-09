import { redactSecrets } from "../agents/prompt.js";
import type { FlareGitProjectState } from "../core/types.js";
import type { IssueRow, ProjectRow } from "./durable-object.js";

export interface MetadataSearchResult { id: string; kind: "repository" | "change" | "issue" | "candidate"; title: string; description: string; href: string }
interface SearchRepository {
  roleOf(userId: string): Promise<unknown>;
  getState(): Promise<FlareGitProjectState>;
  getIssue(number:number):Promise<IssueRow|null>;
  listIssues(state: "open" | "closed"): Promise<IssueRow[]>;
}
export function safeSearchText(value: string, length = 240): string {
  return redactSecrets(value).replace(/https?:\/\/[^\s<>"']+/gi, (raw) => {
    try {
      const url = new URL(raw);
      if (url.username || url.password || [...url.searchParams.keys()].some((key) => /token|secret|password|signature|api.?key|authorization|credential/i.test(key))) return "[REDACTED URL]";
      return raw;
    } catch { return "[REDACTED URL]"; }
  }).replace(/[\x00-\x1f\x7f]/g, " ").slice(0, length);
}
/** Searches already-visible metadata, never Git contents or private agent context. */
export async function searchAccountMetadata(input: {
  query: string; userId: string; references: readonly ProjectRow[];
  repository(id: string): SearchRepository; lifecycle(): Promise<string>;
}): Promise<{ results: MetadataSearchResult[]; incomplete: boolean }> {
  if (input.query.length > 200) throw new RangeError("Search is limited to 200 characters");
  const query = input.query.trim().normalize("NFKC").toLocaleLowerCase("en-US");
  if (!query) return { results: [], incomplete: false };
  if (await input.lifecycle() !== "active") return { results: [], incomplete: true };
  let incomplete = input.references.length > 10;
  const results: MetadataSearchResult[] = [];
  const resultRepositories = new Map<string, SearchRepository>();
  const seen = new Set<string>();
  for (const reference of input.references.slice(0, 10)) {
    if (!/^[a-z0-9]{12,16}$/.test(reference.id) || seen.has(reference.id)) continue;
    seen.add(reference.id);
    const repository = input.repository(reference.id);
    try {
      if (!await repository.roleOf(input.userId)) continue;
      const [state, open, closed] = await Promise.all([repository.getState(), repository.listIssues("open"), repository.listIssues("closed")]);
      if (state.projectId !== reference.id || !await repository.roleOf(input.userId)) { incomplete = true; continue; }
      const local: MetadataSearchResult[] = [];
      const add = (row: MetadataSearchResult) => {
        const title = safeSearchText(row.title, 160), description = safeSearchText(row.description);
        if (`${title} ${description}`.normalize("NFKC").toLocaleLowerCase("en-US").includes(query)) local.push({ ...row, title, description });
      };
      const base = `/#/p/${reference.id}`;
      add({ id: reference.id, kind: "repository", title: state.projectName, description: "Repository", href: `${base}/code` });
      for (const task of Object.values(state.tasks).slice(0, 1000)) {
        if (!/^[a-zA-Z0-9_-]{1,100}$/.test(task.id)) continue;
        add({ id: `${reference.id}:change:${task.id}`, kind: "change", title: task.goal, description: `${state.projectName} · ${task.status}`, href: `${base}/changes` });
      }
      for (const issue of [...open, ...closed]) {
        if (!Number.isSafeInteger(issue.number) || issue.number < 1) continue;
        add({ id: `${reference.id}:issue:${issue.number}`, kind: "issue", title: issue.title, description: `${state.projectName} · #${issue.number} · ${issue.state}`, href: `${base}/issues?n=${issue.number}` });
      }
      if (!await repository.roleOf(input.userId)) { incomplete = true; continue; }
      results.push(...local);
      resultRepositories.set(reference.id, repository);
    } catch { incomplete = true; }
  }
  if (await input.lifecycle() !== "active") return { results: [], incomplete: true };
  const permitted = new Set<string>();
  for (const [id, repository] of resultRepositories) {
    if (await repository.roleOf(input.userId).catch(() => null)) permitted.add(id);
    else incomplete = true;
  }
  if (await input.lifecycle() !== "active") return { results: [], incomplete: true };
  const active:MetadataSearchResult[]=[];
  for(const row of results.filter(row=>permitted.has(row.id.split(':')[0]!)).slice(0,20)){
    if(row.kind!=='issue'){active.push(row);continue;}
    const [project,,number]=row.id.split(':'),repository=resultRepositories.get(project!);if(!repository)continue;
    try{const issue=await repository.getIssue(Number(number));if(!issue||!await repository.roleOf(input.userId)){incomplete=true;continue;}const title=safeSearchText(issue.title,160),description=safeSearchText(row.description.replace(/ · (open|closed)$/u,` · ${issue.state}`));if(`${title} ${description}`.normalize('NFKC').toLocaleLowerCase('en-US').includes(query))active.push({...row,title,description});}catch{incomplete=true;}
  }
  if(await input.lifecycle()!=='active')return {results:[],incomplete:true};
  return {results:active,incomplete};
}
