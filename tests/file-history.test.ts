import {expect, test} from "bun:test";
import {listFileHistory, type CommitInfo, type RepositoryReader} from "../src/server/browse";
import {parseSignedRepositoryBrowseRequest} from "../src/server/public-repositories";
const sha=(letter:string)=>letter.repeat(40);
function fixture(){
  const commits:CommitInfo[]=[
    {hash:sha("a"),treeHash:sha("d"),parents:[sha("b")],message:"restore",author:{name:"A",email:"a@example.test"},committedAt:3},
    {hash:sha("b"),treeHash:sha("e"),parents:[sha("c")],message:"delete",author:{name:"B",email:"b@example.test"},committedAt:2},
    {hash:sha("c"),treeHash:sha("f"),parents:[],message:"create",author:{name:"C",email:"c@example.test"},committedAt:1},
  ];
  const reads:string[]=[];
  const repo:RepositoryReader={
    async log(options){expect(options?.ref).toBe(sha("a"));return commits.slice(options?.offset??0,(options?.offset??0)+(options?.limit??30)).map(commit=>({...commit,committer:commit.author,authoredAt:commit.committedAt}));},
    async readCommit(hash){reads.push(hash);const commit=commits.find(item=>item.hash===hash);return commit?{...commit,committer:commit.author,authoredAt:commit.committedAt}:null;},
    async readTree(hash){return hash===sha("e")?[]:[{name:"file.ts",type:"blob",hash:sha("1"),mode:"100644"}];},
    async readBlob(){throw new Error("History must not read contents");},
  };
  return {repo,commits,reads};
}
test("real object history includes creation, deletion and restoration with stable scanned pagination",async()=>{
  const {repo,commits}=fixture();
  const first=await listFileHistory(repo,commits[0]!,"file.ts",2,0);
  expect(first.commits.map(item=>[item.message,item.pathExists])).toEqual([["restore",true],["delete",false]]);
  expect(first).toMatchObject({commit:sha("a"),scanned:2,nextOffset:2,comparison:"first-parent",followsRenames:true});
  const last=await listFileHistory(repo,commits[0]!,"file.ts",2,first.nextOffset!);
  expect(last.commits.map(item=>item.message)).toEqual(["create"]);
  expect(last.nextOffset).toBeNull();
});
test("an unchanged path produces no matches while preserving the next scanned offset",async()=>{
  const {repo,commits}=fixture();repo.readTree=async()=>[{name:"file.ts",type:"blob",hash:sha("1"),mode:"100644"}];
  const page=await listFileHistory(repo,commits[0]!,"file.ts",1,0);
  expect(page.commits).toEqual([]);expect(page.nextOffset).toBe(1);
});
test("missing parent/tree refuses a page instead of presenting complete history",async()=>{
  const {repo,commits}=fixture();repo.readCommit=async()=>null;
  await expect(listFileHistory(repo,commits[0]!,"file.ts",2,0)).rejects.toThrow("parent is unavailable");
  const other=fixture();other.repo.readTree=async()=>null;
  await expect(listFileHistory(other.repo,other.commits[0]!,"file.ts",2,0)).rejects.toThrow("tree is unavailable");
});
test("signed history parser validates file paths and duplicate parameters before storage access",()=>{
  expect(parseSignedRepositoryBrowseRequest("/commits",new URLSearchParams(`path=file.ts&ref=${sha("a")}&limit=10&offset=10`))).toMatchObject({kind:"history",path:"file.ts",ref:sha("a"),offset:10});
  for(const query of ["path=../secret","path=","path=a&path=b"])expect(()=>parseSignedRepositoryBrowseRequest("/commits",new URLSearchParams(query))).toThrow();
});

test("history reads actual local Git commits and trees across an unrelated edit and a rename",async()=>{
  const {mkdtempSync,rmSync}=await import("node:fs");const {tmpdir}=await import("node:os");const {join}=await import("node:path");
  const directory=mkdtempSync(join(tmpdir(),"flaregit-history-"));
  const git=(...args:string[])=>{const result=Bun.spawnSync(["git","-C",directory,...args],{env:{...process.env,GIT_CONFIG_NOSYSTEM:"1",GIT_CONFIG_GLOBAL:"/dev/null"}});if(result.exitCode!==0)throw new Error(result.stderr.toString());return result.stdout.toString().trim();};
  try{
    git("init","-q");git("config","user.name","Local fixture");git("config","user.email","fixture@example.test");
    await Bun.write(join(directory,"file.ts"),"one\n");git("add",".");git("commit","-qm","create");
    await Bun.write(join(directory,"other.ts"),"unrelated\n");git("add",".");git("commit","-qm","unrelated");
    git("mv","file.ts","renamed.ts");git("commit","-qm","rename");
    const metadata=(hash:string)=>{const [actual,treeHash,parents,message]=git("show","-s","--format=%H%n%T%n%P%n%s",hash).split("\n");const author={name:"Local fixture",email:"fixture@example.test"};return {hash:actual!,treeHash:treeHash!,parents:parents?parents.split(" "):[],message:message!,author,committer:author,authoredAt:1,committedAt:1};};
    const reader:RepositoryReader={
      async log(options){return git("rev-list",`--max-count=${options?.limit??30}`,`--skip=${options?.offset??0}`,options?.ref??"HEAD").split("\n").filter(Boolean).map(metadata);},
      async readCommit(hash){return metadata(hash);},
      async readTree(hash){return git("ls-tree",hash).split("\n").filter(Boolean).map(row=>{const [meta,name]=row.split("\t"),[mode,type,hash]=meta!.split(" ");return {name:name!,mode:mode!,type:type as "blob"|"tree",hash:hash!};});},
      async readBlob(){throw new Error("History should use object identities");},
    };
    const page=await listFileHistory(reader,metadata("HEAD"),"file.ts",10,0);
    expect(page.commits.map(item=>item.message)).toEqual(["rename","create"]);
    expect(page.commits.map(item=>item.pathExists)).toEqual([true,true]);
    expect(page.commits.map(item=>item.path)).toEqual(["renamed.ts","file.ts"]);expect(page.headPath).toBe("renamed.ts");
    expect(page.nextOffset).toBeNull();expect(page.followsRenames).toBe(true);
  }finally{rmSync(directory,{recursive:true,force:true});}
});
