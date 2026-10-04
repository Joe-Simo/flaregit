import {expect,test} from "bun:test";
import {apiJson,ApiError,apiRetryAfterSeconds} from "../src/web/api";

test("read failures preserve HTTP capacity status and server retry guidance",async()=>{
  const original=globalThis.fetch;
  try {
    globalThis.fetch=Object.assign(async()=>Response.json({error:"Repository read budget is temporarily unavailable"},{status:429,headers:{"Retry-After":"17"}}),{preconnect:()=>{}});
    try {await apiJson("/p/p123456789abc/tree");throw new Error("Expected failure");}catch(error){expect(error).toBeInstanceOf(ApiError);if(!(error instanceof ApiError))throw error;expect(error.status).toBe(429);expect(error.retryAfter).toBe(17);expect(error.message).toBe("Repository read budget is temporarily unavailable");}
    globalThis.fetch=Object.assign(async()=>new Response("Requested diff exceeds its bounded read limit",{status:413}),{preconnect:()=>{}});
    try {await apiJson("/p/p123456789abc/diff");throw new Error("Expected failure");}catch(error){expect(error).toBeInstanceOf(ApiError);if(!(error instanceof ApiError))throw error;expect(error.status).toBe(413);expect(error.retryAfter).toBeNull();expect(error.message).toContain("bounded read limit");}
    globalThis.fetch=Object.assign(async()=>new Response("Provider lookup is unavailable",{status:503}),{preconnect:()=>{}});
    try {await apiJson("/p/p123456789abc/blob");throw new Error("Expected failure");}catch(error){expect(error).toBeInstanceOf(ApiError);if(!(error instanceof ApiError))throw error;expect(error.status).toBe(503);expect(error.message).toBe("Provider lookup is unavailable");}
  } finally {globalThis.fetch=original;}
});
test("Retry-After accepts server seconds or dates and rejects unusable guidance",()=>{
  const now=Date.parse("2026-10-04T12:00:00Z");
  expect(apiRetryAfterSeconds("Sun, 04 Oct 2026 12:00:12 GMT",now)).toBe(12);
  expect(apiRetryAfterSeconds("0",now)).toBe(0);
  expect(apiRetryAfterSeconds(null,now)).toBeNull();
  expect(apiRetryAfterSeconds("invalid",now)).toBeNull();
  expect(apiRetryAfterSeconds("-8",now)).toBeNull();
});
