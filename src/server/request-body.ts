export class RequestBodyError extends Error {}
/** Read and parse a bounded object body; cancellation occurs before allocating oversized input. */
export async function readRequestJson<T>(request:Request,maxBytes=131_072):Promise<T>{
 const reader=request.body?.getReader();if(!reader)return {} as T;
 const chunks:Uint8Array[]=[];let size=0;
 for(;;){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>maxBytes){await reader.cancel();throw new RequestBodyError('Request body is too large');}chunks.push(next.value);}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 const raw=new TextDecoder().decode(bytes);if(!raw.trim())return {} as T;
 let value:unknown;try{value=JSON.parse(raw);}catch{throw new RequestBodyError('Invalid JSON request body');}
 if(typeof value!=='object'||value===null||Array.isArray(value))throw new RequestBodyError('Request body must be an object');return value as T;
}

/** Read binary protocol bodies with a hard allocation bound. */
export async function readRequestBytes(request: Request, maxBytes: number): Promise<Uint8Array<ArrayBuffer>> {
 const reader = request.body?.getReader();
 if (!reader) return new Uint8Array(0);
 const chunks: Uint8Array[] = []; let size = 0;
 for (;;) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength;
  if (size > maxBytes) { await reader.cancel(); throw new RequestBodyError("Request body is too large"); } chunks.push(next.value); }
 const bytes = new Uint8Array(size); let offset = 0;
 for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
 return bytes;
}
