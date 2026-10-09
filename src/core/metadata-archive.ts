import { z } from 'zod';

/** Fixed transfer catalog shared by durable storage and the browser archive reader. */
export const METADATA_ARCHIVE_TABLES=Object.freeze(['issues','comments','wiki_revisions','repository_planning','issue_features','repository_private_discussion_entries','repository_public_discussion_entries','release_records','release_edits','migration_native_issue_origins','migration_native_comment_origins','metadata_archive_origins','metadata_archive_history','issue_lifecycle_history'] as const);
export const MAX_METADATA_ARCHIVE_BYTES=8_000_000;
export const archiveIdentitySchema=z.object({projectId:z.string().min(1).max(200),incarnation:z.string().max(200).nullable(),head:z.string().regex(/^[a-f0-9]{40}$/)}).strict();
export const archiveRowSchema=z.record(z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/),z.union([z.string().max(2_000_000),z.number().int().safe(),z.null()]));
export const metadataArchiveSchema=z.object({version:z.union([z.literal(1),z.literal(2)]),source:archiveIdentitySchema,createdAt:z.string().datetime(),tables:z.array(z.object({name:z.enum(METADATA_ARCHIVE_TABLES),columns:z.array(z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/)).max(30),rows:z.array(archiveRowSchema).max(10000)}).strict()).max(METADATA_ARCHIVE_TABLES.length),omissions:z.array(z.string()).max(30)}).strict().refine(value=>value.version===2||!value.tables.some(table=>table.name==='issue_lifecycle_history'),'Portable issue lifecycle history requires archive version 2');
export const metadataArchiveEnvelopeSchema=z.object({archive:metadataArchiveSchema,sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export type ArchiveIdentity=z.infer<typeof archiveIdentitySchema>;
export type MetadataArchive=z.infer<typeof metadataArchiveSchema>;
export type MetadataArchiveEnvelope=z.infer<typeof metadataArchiveEnvelopeSchema>;
