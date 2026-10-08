import {metadataArchiveEnvelopeSchema,MAX_METADATA_ARCHIVE_BYTES} from '../core/metadata-archive';

/** Check the actual exported envelope before displaying its scope or sending a restore. */
export async function checkedEnvelope(value:unknown){
  const parsed=metadataArchiveEnvelopeSchema.parse(value);
  if(new TextEncoder().encode(JSON.stringify(parsed.archive)).length>MAX_METADATA_ARCHIVE_BYTES)throw Error('Archive exceeds 8 MB');
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(parsed.archive)));
  const digest=[...new Uint8Array(bytes)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
  if(digest!==parsed.sha256)throw Error('Archive checksum does not match. Select the original exported file.');
  return parsed;
}
