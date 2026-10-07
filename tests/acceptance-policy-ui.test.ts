import { expect, test } from "bun:test";
import { acceptancePolicyIntent, checkedAcceptancePolicy, persistAcceptancePolicyIntent, readAcceptancePolicyIntent, saveAcceptancePolicy } from "../src/web/acceptance-policy";
const initial={mode:"review-required",version:0,authorizedBy:null,updatedAt:null};
test("default and authorized acceptance policies cannot invent missing approval evidence",()=>{
 expect(checkedAcceptancePolicy(initial).mode).toBe("review-required");
 for(const value of [{...initial,mode:"verified-auto-accept",protectedAdapter:"ticket-booking-browser"},{...initial,version:1},{...initial,authorizedBy:"owner"}])expect(()=>checkedAcceptancePolicy(value)).toThrow();
 expect(checkedAcceptancePolicy({mode:"verified-auto-accept",protectedAdapter:"ticket-booking-browser",version:1,authorizedBy:"owner",updatedAt:1}).version).toBe(1);
});
test("uncertain policy intent retains exact UUID CAS and configuration across scoped recovery",()=>{
 const values=new Map<string,string>(),storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}};
 const intent=acceptancePolicyIntent(null,0,{mode:"verified-auto-accept",protectedAdapter:"ticket-booking-browser"});
 expect(persistAcceptancePolicyIntent(storage,"owner:session", "p123456789abc",intent)).toBe(true);
 expect(readAcceptancePolicyIntent(storage,"owner:session","p123456789abc")).toEqual(intent);
 expect(readAcceptancePolicyIntent(storage,"other:session","p123456789abc")).toBeNull();
 expect(readAcceptancePolicyIntent(storage,"owner:session","pabcdef123456")).toBeNull();
 expect(acceptancePolicyIntent(intent,7,{mode:"review-required"})).toBe(intent);
});
test("historical applied policy is separate from newer current policy and mismatched receipts fail",async()=>{
 const original=fetch,intent=acceptancePolicyIntent(null,0,{mode:"verified-auto-accept",protectedAdapter:"ticket-booking-browser"});
 const applied={mode:"verified-auto-accept",protectedAdapter:"ticket-booking-browser",version:1,authorizedBy:"owner",updatedAt:1},current={mode:"review-required",version:2,authorizedBy:"owner",updatedAt:2};
 let malformed=false;
 globalThis.fetch=Object.assign(async()=>Response.json({appliedPolicy:malformed?{...applied,mode:"review-required",protectedAdapter:undefined}:applied,appliedVersion:1,currentPolicy:current}),{preconnect:original.preconnect});
 try{const result=await saveAcceptancePolicy("p123456789abc",intent,new AbortController().signal);expect(result.appliedVersion).toBe(1);expect(result.currentPolicy.version).toBe(2);expect(result.currentPolicy.mode).toBe("review-required");malformed=true;await expect(saveAcceptancePolicy("p123456789abc",intent,new AbortController().signal)).rejects.toThrow();}finally{globalThis.fetch=original;}
});
