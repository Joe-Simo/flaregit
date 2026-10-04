import { expect,test } from "bun:test";
import { orderedPreviewAssets } from "../src/server/preview-assets.js";
test("preview readiness is last even when filesystem lists index first",()=>{expect(orderedPreviewAssets("./index.html\n./app.js\n./style.css\n")).toEqual(["app.js","style.css","index.html"]);});
test("unsafe or incomplete preview manifest refuses every upload",()=>{for(const listing of ["../index.html\nindex.html","index.html\nindex.html","app.js","index.html\n/a.js","index.html\nfolder\\file.js"])expect(()=>orderedPreviewAssets(listing)).toThrow();});
