import {Database} from 'bun:sqlite';
import {expect,test} from 'bun:test';
import {OrganizationAccessLedger} from '../src/server/organization-access';
import {inheritedRepositoryDiscovery} from '../src/server/inherited-repository-discovery';
test('canonical inherited discovery follows team access and loses it on current revocation',()=>{
 const db=new Database(':memory:');const storage={sql:{exec(query:string,...args:Array<string|number>){const rows=db.query(query).all(...args);return{toArray:()=>rows};}},transactionSync<T>(action:()=>T){return db.transaction(action)();}} as unknown as DurableObjectStorage;
 try{const ledger=new OrganizationAccessLedger(storage);let doc=ledger.createOrganization('org','Organization','owner');doc=ledger.setMember('org','owner',doc.revision,'reader','member');doc=ledger.createTeam('org','owner',doc.revision,'readers','Readers');doc=ledger.setTeamMember('org','owner',doc.revision,'readers','reader',true);doc=ledger.grantRepository('org','owner',doc.revision,'p123456789abc',{kind:'team',id:'readers'},'read');const before=inheritedRepositoryDiscovery(storage,'reader');expect(before.ids).toEqual(['p123456789abc']);ledger.revokeRepositoryGrant('org','owner',doc.revision,'p123456789abc',{kind:'team',id:'readers'});const after=inheritedRepositoryDiscovery(storage,'reader');expect(after.ids).toEqual([]);expect(after.epoch).not.toBe(before.epoch);expect(inheritedRepositoryDiscovery(storage,'outsider').ids).toEqual([]);
 }finally{db.close();}
});
