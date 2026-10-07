import {z} from 'zod';
import type {IssueDraftStorage} from './issue-draft-recovery';
export interface IssueChangeScope {identity:string;projectId:string;issue:number}
const schema=z.object({goal:z.string().min(1).max(200),taskId:z.string().regex(/^[a-z0-9-]{1,64}$/),issue:z.number().int().positive()}).strict();
export type IssueChangeIntent=z.infer<typeof schema>;
// Share the existing verified-principal cleanup namespace, with an issue-specific key.
const key=(scope:IssueChangeScope)=>`flaregit.issue-draft.${JSON.stringify([scope.identity,scope.projectId,scope.issue])}`;
export function recoverIssueChange(storage:IssueDraftStorage,scope:IssueChangeScope):IssueChangeIntent|null {
  const raw=storage.getItem(key(scope));
  if(raw===null)return null;
  if(raw.length>1000)throw new Error('Saved change request is invalid.');
  const value=schema.parse(JSON.parse(raw));
  if(value.issue!==scope.issue)throw new Error('Saved change request belongs to another issue.');
  return value;
}
export function persistIssueChange(storage:IssueDraftStorage,scope:IssueChangeScope,intent:IssueChangeIntent):void {
  const value=schema.parse(intent);
  if(value.issue!==scope.issue)throw new Error('Change request belongs to another issue.');
  const serialized=JSON.stringify(value);
  storage.setItem(key(scope),serialized);
  if(storage.getItem(key(scope))!==serialized)throw new Error('Browser did not retain the original change request.');
}

export function clearIssueChange(storage:IssueDraftStorage,scope:IssueChangeScope):void {storage.removeItem(key(scope));}
