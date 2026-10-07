import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { safeSignInReturn } from "../src/web/sign-in-return";
import { AuthTransitionSurface } from "../src/web/AuthGate";
import { authRecoveryPending,authWorkspaceIntent,type AuthTransitionSnapshot } from "../src/web/auth-transition";
const cold:AuthTransitionSnapshot={authLoaded:false,sessionLoaded:false,signedIn:undefined,userId:undefined,sessionId:undefined,sessionUserId:undefined,sessionStatus:undefined};
const render=(snapshot:AuthTransitionSnapshot,workspaceIntent:boolean)=>renderToStaticMarkup(createElement(AuthTransitionSurface,{snapshot,workspaceIntent,signingIn:false,onRetry:()=>{},signedOut:createElement("p",null,"Confirmed signed-out action"),signedIn:createElement("p",null,"Verified private workspace"),landing:createElement("p",null,"Public marketing landing")}));
test("a direct private issue reload waits for cold Clerk hydration instead of displaying marketing",()=>{
  expect(authWorkspaceIntent("#/p/p123456789abc/issues?n=2")).toBe(true);
  expect(authRecoveryPending(cold,false,true)).toBe(true);
  const html=render(cold,true);expect(html).toContain("Opening your workspace");expect(html).toContain("Waiting for your secure session");expect(html).toContain("Retry sign-in");expect(html).not.toContain("Public marketing landing");expect(html).not.toContain("Verified private workspace");
});
test("partial auth/session hydration cannot flash landing for a private route",()=>{
  for(const snapshot of [{...cold,authLoaded:true},{...cold,sessionLoaded:true},{...cold,authLoaded:true,signedIn:true,userId:"owner"}]){const html=render(snapshot,true);expect(html).toContain("Opening your workspace");expect(html).not.toContain("Public marketing landing");}
});
test("settled signed-out and signed-in phases retain their existing actions and principal guard",()=>{
  const out:AuthTransitionSnapshot={authLoaded:true,sessionLoaded:true,signedIn:false,userId:null,sessionId:null,sessionUserId:null,sessionStatus:null};expect(render(out,true)).toContain("Confirmed signed-out action");expect(render(out,true)).not.toContain("Opening your workspace");
  const active={...out,signedIn:true,userId:"owner",sessionId:"session",sessionUserId:"owner",sessionStatus:"active"};expect(render(active,true)).toContain("Verified private workspace");expect(render({...active,sessionUserId:"other-owner"},true)).not.toContain("Verified private workspace");
});
test("anonymous marketing and public references do not acquire a private hydration gate",()=>{
  for(const hash of ["", "#/", "#/public/p123456789abc", "#/profile/maintainer", "#view=help", "#/join-resume?context=11111111-1111-4111-8111-111111111111", "#https://evil.invalid"])expect(authWorkspaceIntent(hash)).toBe(false);
  expect(render(cold,false)).toContain("Public marketing landing");
});

test("private Releases navigation survives authentication while unknown repository tabs remain rejected",()=>{
  const hash="#/p/p123456789abc/releases";
  expect(authWorkspaceIntent(hash)).toBe(true);
  expect(safeSignInReturn(hash)).toBe("/p/p123456789abc/releases");
  expect(safeSignInReturn(`${hash}?signin=1`)).toBe("/p/p123456789abc/releases");
  expect(render(cold,authWorkspaceIntent(hash))).toContain("Opening your workspace");
  expect(authWorkspaceIntent("#/p/p123456789abc/tags")).toBe(true);
  expect(safeSignInReturn("#/p/p123456789abc/tags?signin=1")).toBe("/p/p123456789abc/tags");
  for(const tab of ["unknown","release-admin","releases-external"])expect(safeSignInReturn(`#/p/p123456789abc/${tab}`)).toBeNull();
});
