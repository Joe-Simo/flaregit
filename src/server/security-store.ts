import {applySecurityReport,normalizeSecurityReport,triageSecurityAlert,SecurityReportError,type SecurityState,type SecurityImport,type SecurityTriage} from '../core/security-report';

/** One repository's private report ledger. Imports and triage use optimistic atomic versions. */
export class SecurityStore{
  constructor(private readonly storage:DurableObjectStorage){storage.sql.exec('CREATE TABLE IF NOT EXISTS repository_security(id INTEGER PRIMARY KEY CHECK(id=1),doc TEXT NOT NULL)');}
  read():SecurityState{const row=this.storage.sql.exec<{doc:string}>('SELECT doc FROM repository_security WHERE id=1').toArray()[0];return row?JSON.parse(row.doc) as SecurityState:{version:0,alerts:[],runs:[]};}
  private save(state:SecurityState){const doc=JSON.stringify(state);if(new TextEncoder().encode(doc).length>5_000_000)throw new SecurityReportError('Security history capacity reached',413);this.storage.sql.exec('INSERT INTO repository_security(id,doc) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET doc=excluded.doc',doc);return state;}
  import(input:SecurityImport,actor:string){const report=normalizeSecurityReport(input.sarif);return this.storage.transactionSync(()=>this.save(applySecurityReport(this.read(),input,report,actor)));}
  triage(id:string,input:SecurityTriage,actor:string){return this.storage.transactionSync(()=>this.save(triageSecurityAlert(this.read(),id,input,actor)));}
}
