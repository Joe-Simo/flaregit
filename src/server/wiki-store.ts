import {normalizeSlug, failure, checkAuthor, checkBody, isRevisionId, linesOf, lineDiff, DEFAULT_HISTORY_LIMIT, MAX_HISTORY_LIMIT, MAX_DIFF_LINES, type WikiRevision, type SaveRequest, type HistoryOptions, type WikiResult, type LineDiff} from '../core/wiki';

/** SQLite revisions are append-only. Head comparison and append share one storage transaction. */
type RevisionRow={slug:string;id:number;author:string;body:string;timestamp:string;parentRevision:number|null};
export class DurableWikiStore {
  constructor(private readonly storage: DurableObjectStorage) {
    storage.sql.exec('CREATE TABLE IF NOT EXISTS wiki_revisions(slug TEXT NOT NULL,id INTEGER NOT NULL,author TEXT NOT NULL,body TEXT NOT NULL,timestamp TEXT NOT NULL,parentRevision INTEGER,PRIMARY KEY(slug,id))');
  }
  list(){return {pages:this.storage.sql.exec<Omit<WikiRevision,'body'>>('SELECT slug,id,author,timestamp,parentRevision FROM wiki_revisions w WHERE id=(SELECT MAX(id) FROM wiki_revisions WHERE slug=w.slug) ORDER BY slug LIMIT 10001').toArray()};}
  read(slugInput: string, revisionId?: number): WikiResult<WikiRevision> {
    const slug = normalizeSlug(slugInput); if (!slug.ok) return slug;
    if (revisionId !== undefined && !isRevisionId(revisionId)) return failure('invalid-revision','A revision id is a positive integer');
    const row = revisionId === undefined
      ? this.storage.sql.exec<RevisionRow>('SELECT * FROM wiki_revisions WHERE slug=? ORDER BY id DESC LIMIT 1',slug.value).toArray()[0]
      : this.storage.sql.exec<RevisionRow>('SELECT * FROM wiki_revisions WHERE slug=? AND id=?',slug.value,revisionId).toArray()[0];
    return row ? {ok:true,value:row} : failure('not-found','That page or revision does not exist');
  }
  save(slugInput: string, request: SaveRequest): WikiResult<WikiRevision> {
    const slug=normalizeSlug(slugInput);if(!slug.ok)return slug;
    if(request.expectedRevision!==null&&!isRevisionId(request.expectedRevision))return failure('invalid-revision','expectedRevision must be null or a positive integer');
    const problem=checkAuthor(request.author)??checkBody(request.body);if(problem)return problem;
    return this.storage.transactionSync(()=>{
      const current=this.read(slug.value),head=current.ok?current.value.id:null;
      if(request.expectedRevision!==head)return failure('conflict','The page changed; reload and merge before saving');
      const usage=this.storage.sql.exec<{bytes:number;revisions:number}>('SELECT COALESCE(SUM(length(CAST(body AS BLOB))),0) AS bytes,COUNT(*) AS revisions FROM wiki_revisions').toArray()[0]!;
      if(usage.revisions>=10000||usage.bytes+new TextEncoder().encode(request.body).length>5_000_000)return failure('capacity','Wiki capacity reached; existing revisions remain preserved');
      const value:WikiRevision={slug:slug.value,id:(head??0)+1,author:request.author.trim(),body:request.body,timestamp:new Date().toISOString(),parentRevision:head};
      this.storage.sql.exec('INSERT INTO wiki_revisions VALUES(?,?,?,?,?,?)',value.slug,value.id,value.author,value.body,value.timestamp,value.parentRevision);
      return {ok:true,value};
    });
  }
  history(slugInput:string,options:HistoryOptions={}):WikiResult<{revisions:readonly Omit<WikiRevision,"body">[];nextBefore:number|null}>{
    const slug=normalizeSlug(slugInput);if(!slug.ok)return slug;
    const limit=options.limit??DEFAULT_HISTORY_LIMIT;
    if(!Number.isSafeInteger(limit)||limit<1||limit>MAX_HISTORY_LIMIT)return failure('invalid-limit','Invalid history limit');
    if(options.before!==undefined&&!isRevisionId(options.before))return failure('invalid-cursor','Invalid history cursor');
    if(!this.read(slug.value).ok)return failure('not-found','That page does not exist');
    const rows=this.storage.sql.exec<Omit<WikiRevision,"body">>('SELECT slug,id,author,timestamp,parentRevision FROM wiki_revisions WHERE slug=? AND id<? ORDER BY id DESC LIMIT ?',slug.value,options.before??Number.MAX_SAFE_INTEGER,limit+1).toArray();
    const revisions=rows.slice(0,limit);return {ok:true,value:{revisions,nextBefore:rows.length>limit?revisions.at(-1)!.id:null}};
  }
  diff(slug:string,from:number,to:number):WikiResult<LineDiff>{
    const a=this.read(slug,from);if(!a.ok)return a;const b=this.read(slug,to);if(!b.ok)return b;
    const left=linesOf(a.value.body),right=linesOf(b.value.body);
    if(left.length>MAX_DIFF_LINES||right.length>MAX_DIFF_LINES)return failure('diff-too-large','A diff compares at most 2000 lines per side');
    return {ok:true,value:lineDiff(left,right)};
  }
  revert(slug:string,to:number,actor:string,expectedRevision:number):WikiResult<WikiRevision>{
    return this.storage.transactionSync(()=>{const target=this.read(slug,to);return target.ok?this.save(slug,{author:actor,body:target.value.body,expectedRevision}):target;});
  }
}
