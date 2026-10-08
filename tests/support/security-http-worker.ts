import fixtureWorker,{MetadataAuthFixture} from './metadata-auth-http-worker';
export class SecurityHttpFixture extends MetadataAuthFixture{
  override async fetch(request:Request){if(new URL(request.url).pathname==='/seed')await this.initialize({projectId:'p123456789abc',projectName:'Fixture',canonicalRepoName:'canonical',head:'a'.repeat(40),tree:'b'.repeat(40),verificationPolicy:{},ownerId:'owner',kind:'import'});return super.fetch(request);}
}
export default fixtureWorker;
