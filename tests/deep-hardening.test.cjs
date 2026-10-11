"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const {JSDOM}=require("jsdom");
const fs=require("node:fs"),path=require("node:path");
global.FileMetaExtraFormats=require("../formats-extra.js");
global.FileMetaZipGuard=require("../zip-guard.js");
global.FileMetaEngine=require("../universal-engine.js");
const E=global.FileMetaEngine,I=require("../metadata-inspector.js");
const concat=(...x)=>Uint8Array.from(x.flatMap(p=>Array.from(p)));
const txt=s=>Uint8Array.from([...s],c=>c.charCodeAt(0));
const be=n=>Uint8Array.from([n>>>24&255,n>>>16&255,n>>>8&255,n&255]);
function chunk(type,v){
 const all=concat(txt(type),v);let crc=0xffffffff;
 for(const z of all){crc^=z;for(let i=0;i<8;i++)crc=(crc&1)?crc>>>1^0xedb88320:crc>>>1;}
 return concat(be(v.length),all,be((crc^0xffffffff)>>>0));
}
const signature=Uint8Array.from([137,80,78,71,13,10,26,10]);
const ihdr=chunk("IHDR",concat(be(8),be(6),[8,2,0,0,0]));
const IDAT=chunk("IDAT",[5,6,7]);
const IEND=chunk("IEND",[]);
const image=(...parts)=>concat(signature,...parts);
test("Valid PNG removes ordinary comments while retaining structural chunks",async()=>{
 const a=image(ihdr,chunk("tEXt",txt("Author\0Alice")),IDAT,IEND);
 const r=await E.process(a,"x.png",{remove:true});
 assert.equal(r.changed,true);assert.equal(r.removed.includes("tEXt"),true);
 assert.equal((await E.process(r.bytes,"x.png",{remove:false})).count,0);
});
test("Malformed PNG missing/duplicate IHDR, IDAT or IEND cannot be marked clean",()=>{
 for(const png of [image(chunk("tEXt",txt("Hi")),IDAT,IEND),image(ihdr,ihdr,IDAT,IEND),image(ihdr,IEND),image(ihdr,IDAT),image(ihdr,IDAT,IEND,IDAT)]){
  assert.throws(()=>E.binary(png,true),/PNG|chunk|IHDR|IEND|IDAT/);
 }
});
test("PNG rejects discontinuous IDAT and unknown critical chunks",()=>{
 assert.throws(()=>E.binary(image(ihdr,IDAT,chunk("tEXt",txt("X")),IDAT,IEND),true),/IDAT/);
 assert.throws(()=>E.binary(image(ihdr,chunk("ABCD",[1,2]),IDAT,IEND),true),/critical/);
});
test("PNG corrupted CRC, invalid width and prohibited palette arrangements are rejected",()=>{
 const bad=image(ihdr,IDAT,IEND);bad[29]^=1;
 assert.throws(()=>E.binary(bad,true),/CRC/);
 const zero=chunk("IHDR",concat(be(0),be(1),[8,2,0,0,0]));
 assert.throws(()=>E.binary(image(zero,IDAT,IEND),true),/IHDR/);
 assert.throws(()=>E.binary(image(ihdr,IDAT,chunk("PLTE",[0,0,0]),IEND),true),/palette/);
});
test("ID3 claims are rejected when followed by arbitrary payload or reserved MPEG bits",async()=>{
 const fake=concat(txt("ID3"),[4,0,0,0,0,0,0],txt("NOTAUDIO"));
 await assert.rejects(()=>E.process(fake,"x.mp3",{remove:true}),/MPEG audio frame/);
 const reserved=concat(txt("ID3"),[4,0,0,0,0,0,0],[255,251,0,0]);
 await assert.rejects(()=>E.process(reserved,"x.mp3",{remove:true}),/MPEG audio frame/);
 const real=concat(txt("ID3"),[4,0,0,0,0,0,0],[255,251,144,0]);
 const clean=await E.process(real,"x.mp3",{remove:true});
 assert.equal(clean.changed,true);assert.deepEqual([...clean.bytes],[255,251,144,0]);
});
test("Repeated same-value JPEG comments remain visible as distinct metadata entries",async()=>{
 const comment=concat([255,254,0,7],txt("Hello"));
 const jpeg=concat([255,216],comment,comment,[255,218,0,6,1,1,0,0,63,0,1,2,255,217]);
 const v=await I.inspect(jpeg,"test.jpg");
 assert.equal(v.fields.filter(f=>f.name==="Comment"&&f.value==="Hello").length,2);
});
const root=path.resolve(__dirname,"..");
const read=p=>fs.readFileSync(path.join(root,p),"utf8");
async function waitFor(check){for(let i=0;i<100;i++){if(check())return;await new Promise(r=>setTimeout(r,25));}throw Error("UI timed out");}
test("Browser inspection succeeds when SubtleCrypto hashing is unavailable",async()=>{
 const dom=new JSDOM(read("index.html"),{url:"http://localhost:8080/",runScripts:"outside-only"}),w=dom.window,d=w.document;
 try{
  w.TextDecoder=TextDecoder;w.TextEncoder=TextEncoder;
  for(const name of ["zip-guard.js","formats-extra.js","universal-engine.js","metadata-extended.js","metadata-inspector.js","content-verifier.js","universal-ui.js"])w.eval(read(name));
  const source=image(ihdr,chunk("tEXt",txt("Creator\0One")),IDAT,IEND);
  Object.defineProperty(d.getElementById("u-files"),"files",{configurable:true,value:[{name:"x.png",size:source.length,arrayBuffer:async()=>source.buffer.slice(0),type:"image/png",lastModified:0}]});
  d.getElementById("u-files").dispatchEvent(new w.Event("change"));
  await waitFor(()=>d.getElementById("u-progress").textContent.startsWith("Inspection finished."));
  const info=JSON.parse(d.getElementById("u-details").textContent)[0];
  assert.equal(info.status,"Inspected");
  assert.ok(info.metadataFields.some(f=>f.name==="Creator"));
  assert.match(info.sha256,/Unavailable|^[0-9a-f]{64}$/);
  assert.equal(info.fileProperties.reportedMimeType,"image/png");
 }finally{dom.window.close();}
});
test("Browser flags invalid PNG instead of quietly reporting no metadata",async()=>{
 const dom=new JSDOM(read("index.html"),{url:"http://localhost:8080/",runScripts:"outside-only"}),w=dom.window,d=w.document;
 try{
  w.TextDecoder=TextDecoder;w.TextEncoder=TextEncoder;
  for(const name of ["zip-guard.js","formats-extra.js","universal-engine.js","metadata-extended.js","metadata-inspector.js","content-verifier.js","universal-ui.js"])w.eval(read(name));
  const source=image(chunk("tEXt",txt("Author\0Test")),IDAT,IEND);
  Object.defineProperty(d.getElementById("u-files"),"files",{configurable:true,value:[{name:"bad.png",size:source.length,arrayBuffer:async()=>source.buffer.slice(0),slice:()=>({arrayBuffer:async()=>source.buffer.slice(0,4096)})}]});
  d.getElementById("u-files").dispatchEvent(new w.Event("change"));
  await waitFor(()=>d.getElementById("u-progress").textContent.startsWith("Inspection finished."));
  const info=JSON.parse(d.getElementById("u-details").textContent)[0];
  assert.match(info.status,/Error/);assert.match(d.getElementById("u-progress").textContent,/1 error/);
 }finally{dom.window.close();}
});
