import { z } from "zod";
import { MAX_BUNDLE_BYTES } from "./private-recovery-bundle";
const assetSchema=z.object({path:z.string().max(120),size:z.number().int().positive().max(MAX_BUNDLE_BYTES),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
const manifestSchema=z.object({commit:z.string().regex(/^[a-f0-9]{40}$/),tree:z.string().regex(/^[a-f0-9]{40}$/),objectCount:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),objectScope:z.literal("exact-accepted-reachable-closure"),totalBytes:z.number().int().positive().max(MAX_BUNDLE_BYTES),assets:z.array(assetSchema).length(5)}).strict();
export type PublicGitManifest=z.infer<typeof manifestSchema>;
/** Parses a receipt only. Does not grant publication, access storage or serve bytes. */
export function parsePublicGitManifest(raw:string):PublicGitManifest {
  const rawBytes=new TextEncoder().encode(raw).byteLength;
  if(rawBytes>8192)throw new Error("Git manifest is too large");
  const manifest=manifestSchema.parse(JSON.parse(raw));
  const paths=new Set(manifest.assets.map(asset=>asset.path));
  if(paths.size!==5||!["HEAD","info/refs","objects/info/packs"].every(path=>paths.has(path)))throw new Error("Git metadata resources differ");
  const pack=manifest.assets.find(asset=>/^objects\/pack\/pack-[a-f0-9]{40}\.pack$/.test(asset.path));
  if(!pack||!paths.has(pack.path.replace(/\.pack$/,".idx")))throw new Error("Git pack and index must be an exact pair");
  if(manifest.totalBytes!==rawBytes+manifest.assets.reduce((total,asset)=>total+asset.size,0))throw new Error("Git retained-byte receipt differs");
  return manifest;
}
/** Strict dumb HTTP discovery. upload-pack query returns info/refs text, never smart RPC. */
export function publicGitResource(input:{method:string;path:string;query:URLSearchParams},manifest:Readonly<PublicGitManifest>):PublicGitManifest["assets"][number] {
  if(!["GET","HEAD"].includes(input.method))throw new Error("Git resource method unavailable");
  const entries=[...input.query.entries()];
  if(entries.length&&(input.path!=="info/refs"||entries.length!==1||entries[0]![0]!=="service"||entries[0]![1]!=="git-upload-pack"))throw new Error("Git resource query unavailable");
  if(input.path.includes("%")||input.path.includes("\\")||input.path.startsWith("/")||input.path.split("/").some(part=>!part||part==="."||part===".."))throw new Error("Invalid Git resource path");
  const asset=manifest.assets.find(item=>item.path===input.path);
  if(!asset)throw new Error("Git resource unavailable");
  return asset;
}
