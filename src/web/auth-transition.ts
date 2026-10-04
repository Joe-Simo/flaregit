import {safeSignInReturn} from './sign-in-return';
export interface AuthTransitionSnapshot {authLoaded:boolean;sessionLoaded:boolean;signedIn:boolean|undefined;userId:string|null|undefined;sessionId:string|null|undefined;sessionUserId:string|null|undefined;sessionStatus:string|null|undefined}
export function authTransition(snapshot:AuthTransitionSnapshot):'pending'|'signed-out'|'signed-in'{
 if(!snapshot.authLoaded||!snapshot.sessionLoaded||snapshot.signedIn===undefined||snapshot.userId===undefined)return 'pending';
 if(snapshot.signedIn===false&&snapshot.userId===null&&(!snapshot.sessionId||snapshot.sessionStatus==='pending'))return 'signed-out';
 if(snapshot.signedIn===true&&snapshot.userId&&snapshot.sessionId&&snapshot.sessionUserId===snapshot.userId&&snapshot.sessionStatus==='active')return 'signed-in';
 return 'pending';
}
/** One continuous pending attempt keeps its deadline while SDK identity fields settle. */
export function authRecoveryPending(snapshot:AuthTransitionSnapshot,signingIn:boolean):boolean{return authTransition(snapshot)==="pending"&&(signingIn||snapshot.signedIn===true||Boolean(snapshot.userId)||Boolean(snapshot.sessionId));}
export function signInRecoveryUrl(destination:string):string{const safe=safeSignInReturn(destination)??'/';return `/#${safe}${safe.includes('?')?'&':'?'}signin=1`;}

export function recoverSignIn(destination:string,browser:{replace:(url:string)=>void;reload:()=>void}):void{browser.replace(signInRecoveryUrl(destination));browser.reload();}
