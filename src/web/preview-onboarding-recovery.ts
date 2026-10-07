import {z} from 'zod';
export interface PreviewRequestStorage{getItem(key:string):string|null;setItem(key:string,value:string):void}
const requestSchema=z.object({requestId:z.uuid()}).strict();
export type PreviewRequest=z.infer<typeof requestSchema>;
const storageKey=(identity:string,projectId:string)=>`flaregit.preview-onboarding.${JSON.stringify([identity,projectId])}`;
export function readPreviewRequest(storage:PreviewRequestStorage,identity:string,projectId:string):PreviewRequest|null{
 const raw=storage.getItem(storageKey(identity,projectId));if(raw===null)return null;
 if(raw.length>256)throw Error('Saved preview request is invalid. No new request was sent.');
 return requestSchema.parse(JSON.parse(raw));
}
export function savePreviewRequest(storage:PreviewRequestStorage,identity:string,projectId:string,request:PreviewRequest):PreviewRequest{
 if(!identity||!projectId)throw Error('Sign in before preparing a preview request.');
 const exact=requestSchema.parse(request),prior=readPreviewRequest(storage,identity,projectId);
 if(prior&&prior.requestId!==exact.requestId)throw Error('Recover the original preview request before preparing another.');
 const raw=JSON.stringify(exact),key=storageKey(identity,projectId);storage.setItem(key,raw);
 if(storage.getItem(key)!==raw)throw Error('Preview recovery could not be saved. No request was sent.');
 return exact;
}
