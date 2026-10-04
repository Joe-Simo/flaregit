/** Presentation only: this does not establish Git existence or acceptance. */
export function recordedAcceptedCommit(value:string|null|undefined):value is string{return typeof value==="string"&&/^[a-f0-9]{40}$/.test(value)&&!/^0{40}$/.test(value);}
export function acceptedCommitLabel(value:string|null|undefined,length=7):string{return recordedAcceptedCommit(value)?value.slice(0,length):"No accepted commit yet";}
