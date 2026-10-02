import { expect,test } from "bun:test";
import { publicProfileProjection } from "../src/server/public-profile";
const profile = { handle: "contributor", displayName: "Contributor", bio: "Public bio", joinedAt: "2026-10-02" };
test("legacy/private profiles cannot be published by projection or stale handle aliases",()=>{
  expect(publicProfileProjection("contributor",{profile,visibility:"private",version:0,ownerId:null})).toBeNull();
  expect(publicProfileProjection("old-handle",{profile,visibility:"public",version:1,ownerId:"private-auth-subject"})).toBeNull();
});
test("public profile exposes an allowlist and marks identity as self-described",()=>{
  const output=publicProfileProjection("contributor",{profile,visibility:"public",version:1,ownerId:"private-auth-subject"});
  expect(output).toEqual({...profile,version:1,identityVerification:"self-described"});
  expect(JSON.stringify(output)).not.toContain("private-auth-subject");
});

test("known credentials and credential-bearing URL bios remain unpublished even in legacy public state",()=>{
  expect(publicProfileProjection("contributor",{profile:{...profile,bio:"https://user:secret@example.com/repository"},visibility:"public",version:1,ownerId:"owner"})).toBeNull();
  expect(publicProfileProjection("contributor",{profile:{...profile,bio:"https://example.com/?token=secret"},visibility:"public",version:1,ownerId:"owner"})).toBeNull();
});
