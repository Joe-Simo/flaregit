import type {BuildFile} from './static-build-artifact';

export const STATIC_PREVIEW_SUPPORT = {
  entrypoint: 'index.html',
  inputs: ['HTML', 'React with JavaScript or TypeScript modules'],
  execution: 'Offline static build; repository scripts and server processes are not run',
  maxFiles: 512,
  maxSourceBytes: 16777216,
  maxFileBytes: 4194304,
} as const;
export const STATIC_PREVIEW_UNSUPPORTED = 'preview_source_unsupported';
export class StaticPreviewNotSupportedError extends Error {
  constructor() {
    super('This repository needs a root index.html for an isolated static preview. README-only repositories and server applications do not have a supported preview entrypoint.');
    this.name = 'StaticPreviewNotSupportedError';
  }
}
/** Called only after trusted Git object and manifest verification, before funding
 * or dispatching contributor code in the isolated build namespace. */
export function assertStaticPreviewSource(files: readonly BuildFile[]): void {
  if (!files.some(file => file.kind === 'file' && file.path === STATIC_PREVIEW_SUPPORT.entrypoint)) throw new StaticPreviewNotSupportedError();
}
