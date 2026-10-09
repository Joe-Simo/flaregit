/** Membership generations survive deletion and never depend on a timestamp or
 * row identity. Triggers also cover direct SQL mutations and INSERT OR REPLACE. */
export class MembershipEpochs{
 constructor(private readonly storage:Pick<DurableObjectStorage,'sql'>){
  storage.sql.exec(`
   CREATE TABLE IF NOT EXISTS membership_epochs(user_id TEXT PRIMARY KEY,epoch INTEGER NOT NULL CHECK(epoch>=1));
   CREATE TABLE IF NOT EXISTS membership_roster_generation(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL CHECK(revision>=1));
   INSERT OR IGNORE INTO membership_roster_generation VALUES(1,1);
   INSERT OR IGNORE INTO membership_epochs(user_id,epoch) SELECT user_id,1 FROM members;
   CREATE TRIGGER IF NOT EXISTS member_epoch_insert AFTER INSERT ON members BEGIN
    INSERT INTO membership_epochs(user_id,epoch) VALUES(NEW.user_id,1) ON CONFLICT(user_id) DO UPDATE SET epoch=epoch+1;
   END;
   CREATE TRIGGER IF NOT EXISTS member_epoch_delete AFTER DELETE ON members BEGIN
    INSERT INTO membership_epochs(user_id,epoch) VALUES(OLD.user_id,1) ON CONFLICT(user_id) DO UPDATE SET epoch=epoch+1;
   END;
   CREATE TRIGGER IF NOT EXISTS member_epoch_permission AFTER UPDATE OF role,user_id ON members
   WHEN OLD.role!=NEW.role OR OLD.user_id!=NEW.user_id BEGIN
    INSERT INTO membership_epochs(user_id,epoch) VALUES(OLD.user_id,1) ON CONFLICT(user_id) DO UPDATE SET epoch=epoch+1;
    INSERT INTO membership_epochs(user_id,epoch) SELECT NEW.user_id,1 WHERE OLD.user_id!=NEW.user_id ON CONFLICT(user_id) DO UPDATE SET epoch=epoch+1;
   END;
   CREATE TRIGGER IF NOT EXISTS member_roster_insert AFTER INSERT ON members BEGIN UPDATE membership_roster_generation SET revision=revision+1 WHERE id=1; END;
   CREATE TRIGGER IF NOT EXISTS member_roster_delete AFTER DELETE ON members BEGIN UPDATE membership_roster_generation SET revision=revision+1 WHERE id=1; END;
   CREATE TRIGGER IF NOT EXISTS member_roster_update AFTER UPDATE OF role,user_id ON members WHEN OLD.role!=NEW.role OR OLD.user_id!=NEW.user_id BEGIN UPDATE membership_roster_generation SET revision=revision+1 WHERE id=1; END;
  `);
 }
 read(userId:string):number{
  const row=this.storage.sql.exec<{epoch:number}>('SELECT epoch FROM membership_epochs WHERE user_id=?',userId).toArray()[0];
  if(!row||!Number.isSafeInteger(row.epoch)||row.epoch<1||row.epoch>=Number.MAX_SAFE_INTEGER)throw Error('Membership epoch unavailable');
  return row.epoch;
 }
 generation():number{const revision=this.storage.sql.exec<{revision:number}>('SELECT revision FROM membership_roster_generation WHERE id=1').toArray()[0]?.revision;if(!revision||!Number.isSafeInteger(revision)||revision>=Number.MAX_SAFE_INTEGER)throw Error('Membership roster generation unavailable');return revision;}
}
