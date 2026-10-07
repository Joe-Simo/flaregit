import type {RepositoryCreationRequest} from './repository-creation-request';
export function repositoryInitializationProgress(initialization:RepositoryCreationRequest['initialization']){
 return initialization==='empty'?'Initializing the empty repository and checking that its default branch has no commits…':'Initializing the repository and checking its first committed Git state…';
}
