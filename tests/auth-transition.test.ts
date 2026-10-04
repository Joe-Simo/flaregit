import{expect,test}from'bun:test';import{authTransition,authRecoveryPending,signInRecoveryUrl,recoverSignIn,type AuthTransitionSnapshot}from'../src/web/auth-transition';
const active:AuthTransitionSnapshot={authLoaded:true,sessionLoaded:true,signedIn:true,userId:'owner',sessionId:'session',sessionUserId:'owner',sessionStatus:'active'};
test('workspace renders only a loaded active session for the same authenticated principal',()=>{expect(authTransition(active)).toBe('signed-in');for(const change of [{authLoaded:false},{sessionLoaded:false},{signedIn:undefined},{userId:undefined},{sessionId:null},{sessionUserId:'replacement'},{sessionStatus:'pending'},{sessionStatus:'ended'}])expect(authTransition({...active,...change})).toBe('pending');});
test('signed-out and pending onboarding remain public while inconsistent active identity waits',()=>{expect(authTransition({...active,signedIn:false,userId:null,sessionId:null,sessionUserId:null,sessionStatus:null})).toBe('signed-out');expect(authTransition({...active,signedIn:false,userId:null,sessionStatus:'pending'})).toBe('signed-out');expect(authTransition({...active,signedIn:false,userId:null})).toBe('pending');});
test('recovery uses only validated product intent and never replays OAuth callbacks or credentials',()=>{expect(signInRecoveryUrl('/community?view=following')).toBe('/#/community?view=following&signin=1');expect(signInRecoveryUrl('/')).toBe('/#/?signin=1');for(const path of ['/sign-in/sso-callback?code=synthetic','https://evil.invalid','/account?token=synthetic'])expect(signInRecoveryUrl(path)).toBe('/#/?signin=1');});

test("retry replaces callback or same-target location before forcing a reload every time",()=>{const calls:string[]=[];const browser={replace:(url:string)=>calls.push('replace:'+url),reload:()=>calls.push('reload')};recoverSignIn('/community?view=following',browser);recoverSignIn('/community?view=following',browser);expect(calls).toEqual(['replace:/#/community?view=following&signin=1','reload','replace:/#/community?view=following&signin=1','reload']);calls.length=0;recoverSignIn('/sign-in/sso-callback?code=synthetic',browser);expect(calls).toEqual(['replace:/#/?signin=1','reload']);});

test("partial SDK identity updates remain one pending recovery attempt until a settled phase",()=>{
 const pending={...active,authLoaded:false,sessionLoaded:false};
 for(const update of [{userId:undefined,sessionId:undefined},{userId:'user',sessionId:undefined},{userId:'user',sessionId:'session'},{userId:'user',sessionId:null},{userId:'replacement',sessionId:'replacement-session'}])expect(authRecoveryPending({...pending,...update},true)).toBe(true);
 expect(authRecoveryPending(active,true)).toBe(false);
 expect(authRecoveryPending({...active,signedIn:false,userId:null,sessionId:null,sessionUserId:null,sessionStatus:null},true)).toBe(false);
 expect(authRecoveryPending({...pending,userId:undefined,sessionId:undefined,signedIn:undefined},false)).toBe(false);
 expect(authRecoveryPending(pending,true)).toBe(true);
});
