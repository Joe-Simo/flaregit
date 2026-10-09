import {z} from 'zod';
export const issueEventSourceSchema=z.object({number:z.number().int().positive().safe(),incarnation:z.string().min(1).max(200)}).strict();
export type IssueEventSource=z.infer<typeof issueEventSourceSchema>;
/** Prose never establishes source authority. Separate metadata preserves the raw
 * audit rows while reader projections can withhold inactive issue events. */
export function ensureIssueEventSources(storage:Pick<DurableObjectStorage,'sql'>){storage.sql.exec('CREATE TABLE IF NOT EXISTS activity_issue_sources(activity_id INTEGER PRIMARY KEY,issue_number INTEGER NOT NULL,incarnation TEXT NOT NULL); CREATE TABLE IF NOT EXISTS inbox_issue_sources(inbox_id INTEGER PRIMARY KEY,issue_number INTEGER NOT NULL,incarnation TEXT NOT NULL)');}
export function bindIssueActivity(storage:Pick<DurableObjectStorage,'sql'>,id:number,source:IssueEventSource){issueEventSourceSchema.parse(source);storage.sql.exec('INSERT INTO activity_issue_sources VALUES(?,?,?)',id,source.number,source.incarnation);}
export function sensitiveLegacyIssueEvent(type:string){return type.startsWith('issue.')||type==='comment.added';}
export function genericLegacyIssueEvent(type:string){return type==='comment.added'?'Comment added':'Issue activity';}
