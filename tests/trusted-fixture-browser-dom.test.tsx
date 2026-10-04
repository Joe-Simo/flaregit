import {test,expect} from "bun:test";
import {mkdtemp,readdir,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {renderToStaticMarkup} from "react-dom/server";
import {App as TicketApp} from "../src/fixtures/ticket-booking/template/src/App";
import {App as ShippingApp} from "../src/fixtures/shipping-calculator/template/src/App";
test("actual fixture markup exposes selected event identity and visible individual receipt amounts without an aggregate shortcut",()=>{const ticket=renderToStaticMarkup(<TicketApp/>),shipping=renderToStaticMarkup(<ShippingApp/>);expect(ticket).toContain('id="ticket-event-title" data-event-id="cf-connect-2026"');expect(ticket).toContain("Cloudflare Connect 2026");expect(shipping).toContain('id="shipping-receipt"');expect(shipping).toContain("Itemized Receipt");expect(shipping).toContain("Base freight (5 kg)");expect(shipping).toContain('data-receipt-amount="true">$15.00');expect(shipping).not.toContain("data-receipt-sum");expect(shipping).toContain('id="shipping-total-price">Total: $15.00');});
test("both actual fixture templates build as browser assets after observation markup changes",async()=>{
 const directory=await mkdtemp(join(tmpdir(),"flaregit-fixture-cli-build-"));
 try{
  const results=await Promise.allSettled(["ticket-booking","shipping-calculator"].map(async fixture=>{
   const outdir=join(directory,fixture),entrypoint=resolve(import.meta.dir,`../src/fixtures/${fixture}/template/index.html`);
   // The production build uses Bun CLI subprocesses. Each compiler owns its file
   // descriptors independently of other builds and the concurrently running suite.
   const buildProcess=Bun.spawn([process.execPath,"build",entrypoint,"--target","browser","--minify","--define",'process.env.NODE_ENV="production"',"--outdir",outdir],{stdout:"pipe",stderr:"pipe"});
   const deadline=setTimeout(()=>buildProcess.kill(),10000);
   try{
    const [exit,stdout,stderr]=await Promise.all([buildProcess.exited,new Response(buildProcess.stdout).text(),new Response(buildProcess.stderr).text()]);
    if(exit!==0)throw Error(`${fixture} browser build failed (${exit}): ${stderr||stdout}`);
   }finally{clearTimeout(deadline);}
   const files=await readdir(outdir,{recursive:true});
   expect(files.some(file=>file.endsWith(".js"))).toBe(true);
   expect(files.some(file=>file.endsWith(".svg"))).toBe(true);
   const htmlPath=files.find(file=>file.endsWith(".html"));expect(htmlPath).toBeDefined();
   if(!htmlPath)throw Error("Built fixture HTML is missing");
   const html=await Bun.file(join(outdir,htmlPath)).text();
   const link=/<link\b[^>]*rel=["']icon["'][^>]*>/i.exec(html)?.[0];expect(link).toBeDefined();
   const href=link&&/href=["']([^"']+)["']/i.exec(link)?.[1];expect(href).toBeDefined();
   if(!href)throw Error("Built favicon link is missing");
   expect(href.endsWith(".svg")).toBe(true);
   expect(href.startsWith("http:")||href.startsWith("https:")||href.startsWith("data:")).toBe(false);
   const asset=resolve(outdir,href.replace(/^\//,""));expect(asset.startsWith(outdir+"/")).toBe(true);
   expect(await Bun.file(asset).exists()).toBe(true);
   expect(await Bun.file(asset).text()).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
  }));
  const failures=results.flatMap(result=>result.status==="rejected"?[result.reason]:[]);if(failures.length)throw new AggregateError(failures,"Fixture browser builds failed");
 }finally{await rm(directory,{recursive:true,force:true});}
},20000);
