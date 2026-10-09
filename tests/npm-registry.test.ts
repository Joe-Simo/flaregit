import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryPackageStore, PackageRegistry } from "../src/core/package-registry";
import { handleNpmRegistryCall } from "../src/server/npm-registry";

async function publishBody(name = "@alice/binary-fixture", version = "1.0.0") {
  const bytes = new Uint8Array([31, 139, 0, 255, 128, 1]);
  const hash = async (algorithm: string) => new Uint8Array(await crypto.subtle.digest(algorithm, bytes));
  const integrity = `sha512-${Buffer.from(await hash("SHA-512")).toString("base64")}`;
  const shasum = Buffer.from(await hash("SHA-1")).toString("hex");
  return { name, access: "restricted", "dist-tags": { latest: version }, versions: { [version]: { name, version, dist: { integrity, shasum } } }, _attachments: { "package.tgz": { data: Buffer.from(bytes).toString("base64"), length: bytes.length } } };
}

test("npm versions preserve binary bytes, enforce namespace/private scope, verify hashes and refuse overwrite", async () => {
  const store = new MemoryPackageStore(), registry = new PackageRegistry(store);
  const body = await publishBody();
  const url = "https://registry.test/npm/@alice%2fbinary-fixture";
  const call = { method: "PUT", url, body, userId: "alice-id", namespaces: ["alice"], canPublish: true };
  expect((await handleNpmRegistryCall(registry, { ...call, userId: undefined })).status).toBe(401);
  expect((await handleNpmRegistryCall(registry, { ...call, namespaces: ["bob"] })).status).toBe(403);
  expect((await handleNpmRegistryCall(registry, call)).status).toBe(201);
  expect((await handleNpmRegistryCall(registry, call)).status).toBe(409);
  expect((await handleNpmRegistryCall(registry, { method: "GET", url, body: undefined })).status).toBe(404);
  const reply = await handleNpmRegistryCall(registry, { ...call, method: "GET" });
  const packument = JSON.parse(reply.body as string);
  const tarball = packument.versions["1.0.0"].dist.tarball;
  expect((await handleNpmRegistryCall(registry, { ...call, method: "GET", url: tarball })).body).toEqual(new Uint8Array([31, 139, 0, 255, 128, 1]));
  store.getVersion(body.name, "1.0.0")!.files.get("npm/package.tgz")!.bytes[0] = 0;
  expect((await handleNpmRegistryCall(registry, { ...call, method: "GET", url: tarball })).status).toBe(500);
  const invalid = await publishBody("@alice/other");
  invalid._attachments["package.tgz"].data = Buffer.from([1, 2, 3, 4, 5, 6]).toString("base64");
  expect((await handleNpmRegistryCall(registry, { ...call, url: "https://registry.test/npm/@alice%2fother", body: invalid })).status).toBe(400);
});

test("stock npm publishes and installs a private scoped package containing binary files, then rejects revoked credentials", async () => {
  const registry = new PackageRegistry();
  let active = true;
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", async fetch(request) {
    const token = request.headers.get("authorization");
    if (token && (token !== "Bearer local-fixture-token" || !active)) return new Response("Revoked", { status: 401 });
    const reply = await handleNpmRegistryCall(registry, { method: request.method, url: request.url, body: request.method === "PUT" ? await request.json() : undefined,
      ...(token ? { userId: "alice-id", namespaces: ["alice"], canPublish: true } : {}) });
    return new Response(reply.body, { status: reply.status, headers: { "content-type": reply.contentType } });
  } });
  const directory = await mkdtemp(join(tmpdir(), "flaregit-npm-"));
  const publisher = join(directory, "publisher"), consumer = join(directory, "consumer");
  try {
    await mkdir(publisher); await mkdir(consumer);
    const registryUrl = `http://127.0.0.1:${server.port}/npm/`;
    const config = join(directory, "npmrc");
    await writeFile(config, `registry=${registryUrl}\n//127.0.0.1:${server.port}/npm/:_authToken=local-fixture-token\n`);
    await writeFile(join(publisher, "package.json"), JSON.stringify({ name: "@alice/stock-fixture", version: "1.0.0", main: "index.cjs" }));
    await writeFile(join(publisher, "index.cjs"), "module.exports = 42;\n");
    const binary = new Uint8Array([0, 255, 128, 13, 10, 0, 1]);
    await writeFile(join(publisher, "binary.dat"), binary);
    const run = async (cwd: string, args: string[]) => {
      const process = Bun.spawn(["npm", ...args, "--userconfig", config, "--cache", join(directory, "cache"), "--fetch-retries=0"], { cwd, stdout: "pipe", stderr: "pipe", env: { ...Bun.env, npm_config_update_notifier: "false" } });
      const [stdout, stderr, code] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited]);
      return { code, output: stdout + stderr };
    };
    const publish = await run(publisher, ["publish", "--access=restricted", "--ignore-scripts"]);
    expect(publish.output).not.toContain("E403"); expect(publish.code).toBe(0);
    await writeFile(join(consumer, "package.json"), JSON.stringify({ name: "consumer", version: "1.0.0", private: true }));
    const installed = await run(consumer, ["install", "@alice/stock-fixture@1.0.0", "--ignore-scripts", "--no-audit", "--no-fund"]);
    expect(installed.output).not.toContain("ERR!"); expect(installed.code).toBe(0);
    expect(new Uint8Array(await Bun.file(join(consumer, "node_modules/@alice/stock-fixture/binary.dat")).arrayBuffer())).toEqual(binary);
    const duplicate = await run(publisher, ["publish", "--access=restricted", "--ignore-scripts"]);
    expect(duplicate.code).not.toBe(0);
    active = false;
    const revoked = await run(consumer, ["view", "@alice/stock-fixture@1.0.0", "--json"]);
    expect(revoked.code).not.toBe(0);
    expect(revoked.output).toContain("E401");
  } finally { server.stop(true); await rm(directory, { recursive: true, force: true }); }
}, 30_000);

 test("npm latest tags follow publish order when a lower version is released later", async () => {
 const registry=new PackageRegistry();const name="@alice/backport";const url="http://registry/npm/"+encodeURIComponent(name);
 for(const version of ["2.0.0","1.1.0"]){const body=await publishBody(name,version);expect((await handleNpmRegistryCall(registry,{method:"PUT",url,body,userId:"owner",namespaces:["alice"],canPublish:true})).status).toBe(201);}
 const result=await handleNpmRegistryCall(registry,{method:"GET",url,body:undefined,userId:"owner"});expect(JSON.parse(result.body as string)["dist-tags"].latest).toBe("1.1.0");
 });

test('concurrent npm publications assign unique stored order and keep independent explicit tags',async()=>{
 const store=new MemoryPackageStore(),registry=new PackageRegistry(store),name='@alice/concurrent-tags',url='http://registry/npm/'+encodeURIComponent(name),call={method:'PUT',url,userId:'owner',namespaces:['alice'],canPublish:true};
 const bodies=await Promise.all(['9.0.0','1.0.0'].map(version=>publishBody(name,version)));
 expect((await Promise.all(bodies.map(body=>handleNpmRegistryCall(registry,{...call,body})))).every(reply=>reply.status===201)).toBe(true);
 const saved=store.versionsOf(name);expect(saved.map(version=>version.publication)).toEqual([1,2]);
 const latest=(await handleNpmRegistryCall(registry,{method:'GET',url,body:undefined,userId:'owner'}));expect(JSON.parse(latest.body as string)['dist-tags'].latest).toBe(saved[1]!.version);
 const beta=await publishBody(name,'2.0.0-beta.1');
 const betaBody={...beta,'dist-tags':{beta:'2.0.0-beta.1'}};expect((await handleNpmRegistryCall(registry,{...call,body:betaBody})).status).toBe(201);
 const packument=JSON.parse((await handleNpmRegistryCall(registry,{method:'GET',url,body:undefined,userId:'owner'})).body as string);expect(packument['dist-tags']).toEqual({latest:saved[1]!.version,beta:'2.0.0-beta.1'});
 expect((await handleNpmRegistryCall(registry,{...call,body:{...betaBody,'dist-tags':{latest:'2.0.0-beta.1'}}})).status).toBe(409);
 expect(JSON.parse((await handleNpmRegistryCall(registry,{method:'GET',url,body:undefined,userId:'owner'})).body as string)['dist-tags']).toEqual(packument['dist-tags']);
});
