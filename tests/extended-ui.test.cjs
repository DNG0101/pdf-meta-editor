"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const {JSDOM}=require("jsdom");
const root=path.resolve(__dirname,"..");
const read=p=>fs.readFileSync(path.join(root,p),"utf8");
const ascii=s=>Uint8Array.from([...s],ch=>ch.charCodeAt(0));
const le=n=>Uint8Array.from([n&255,n>>>8&255,n>>>16&255,n>>>24&255]);
const cat=(...a)=>Uint8Array.from(a.flatMap(x=>Array.from(x)));
function bmp(){
 const dib=new Uint8Array(40);dib.set(le(40));dib.set(le(320),4);dib.set(le(200),8);dib[12]=1;dib[14]=24;
 return cat(ascii("BM"),le(54),[0,0,0,0],le(54),dib);
}
async function waitFor(predicate){for(let i=0;i<100;i++){if(predicate())return;await new Promise(r=>setTimeout(r,20));}throw Error("Browser inspector did not finish");}
test("Automatic inspector exposes read-only BMP fields and supports metadata search",async()=>{
 const dom=new JSDOM(read("index.html"),{url:"http://localhost:8080/",runScripts:"outside-only"});const w=dom.window,d=w.document;
 try{
  w.TextDecoder=TextDecoder;w.TextEncoder=TextEncoder;
  Object.defineProperty(w.crypto,"subtle",{configurable:true,value:{digest:async()=>new ArrayBuffer(32)}});
  for(const script of ["zip-guard.js","formats-extra.js","universal-engine.js","metadata-extended.js","metadata-inspector.js","content-verifier.js","universal-ui.js"])w.eval(read(script));
  const file=bmp(),input=d.getElementById("u-files");
  Object.defineProperty(input,"files",{configurable:true,value:[{name:"sample.bmp",size:file.length,arrayBuffer:async()=>file.buffer.slice(0)}]});
  input.dispatchEvent(new w.Event("change"));
  await waitFor(()=>d.getElementById("u-progress").textContent.startsWith("Inspection finished."));
  const result=JSON.parse(d.getElementById("u-details").textContent)[0];
  assert.equal(result.format,"bmp");
  assert.equal(result.count,"Not supported");
  assert.equal(result.status,"Unsupported / inspect only");
  assert.equal(result.metadataFields.find(f=>f.name==="Width")?.value,"320");
  assert.equal(result.metadataFields.find(f=>f.name==="Height")?.value,"200");
  assert.match(d.getElementById("u-fields").textContent,/320/);
  const search=d.getElementById("u-filter");
  search.value="width";search.dispatchEvent(new w.Event("input"));
  const list=d.getElementById("u-fields").textContent;
  assert.match(list,/Width/);assert.doesNotMatch(list,/Height/);
  assert.match(list,/Showing 1 of/);
  assert.match(list,/Coverage: Partial/);
 }finally{dom.window.close();}
});
