"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const {JSDOM}=require("jsdom"),fs=require("node:fs"),path=require("node:path");
const Bridge=require("../exiftool-bridge.js");
const root=path.resolve(__dirname,"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");
const a=s=>new TextEncoder().encode(s);
const cat=(...parts)=>Uint8Array.from(parts.flatMap(p=>Array.from(p)));
const be=n=>Uint8Array.from([n>>>24&255,n>>>16&255,n>>>8&255,n&255]);
function chunk(name,payload){
 const d=cat(a(name),payload);let crc=0xffffffff;
 for(const b of d){crc^=b;for(let j=0;j<8;j++)crc=(crc&1)?crc>>>1^0xedb88320:crc>>>1;}
 return cat(be(payload.length),d,be((crc^0xffffffff)>>>0));
}
function png(){return cat([137,80,78,71,13,10,26,10],chunk("IHDR",cat(be(2),be(3),[8,2,0,0,0])),chunk("tEXt",a("Author\0Alice")),chunk("IDAT",[1,2,3]),chunk("IEND",[]));}
const testObject={SourceFile:"/input/demo.png","[File]FileName":"demo.png","[EXIF]DateTimeOriginal":"2026:10:11 14:00:00","[MakerNotes]CameraUniqueID":"ABC","[XMP]Creator":["Alice","Bob"],"[GPS]GPSLatitude":17.384,"[EXIF]Custom":"<script>alert(1)</script>"};
test("ExifTool JSON import preserves group names and complex values",()=>{
 const r=Bridge.fromJson(JSON.stringify([testObject]),"demo.png");
 assert.ok(r.fields.some(f=>f.name==="[EXIF]DateTimeOriginal"&&f.value==="2026:10:11 14:00:00"));
 assert.equal(r.fields.find(f=>f.name==="[XMP]Creator")?.value,'["Alice","Bob"]');
 assert.equal(r.fields.find(f=>f.name==="[GPS]GPSLatitude")?.value,"17.384");
 assert.equal(r.fields.find(f=>f.name==="[File]FileName")?.kind,"technical");
 assert.match(r.coverage,/ExifTool/);
});
test("External ExifTool JSON cannot silently attach tags from a different file",()=>{
 assert.throws(()=>Bridge.fromJson([testObject],"different.png"),/exactly one SourceFile/);
 assert.throws(()=>Bridge.fromJson([testObject,testObject],"demo.png"),/exactly one SourceFile/);
 assert.throws(()=>Bridge.fromJson([],"demo.png"),/1–1000/);
});
test("Huge ExifTool tag values show explicit truncation instead of disappearing",()=>{
 const r=Bridge.normalize({SourceFile:"large.png","[XMP]Description":"A".repeat(150000)});
 const field=r.fields.find(f=>f.name==="[XMP]Description");
 assert.equal(field.complete,false);
 assert.ok(field.value.length>500);
 assert.ok(r.warnings.some(w=>w.includes("truncated")));
});
test("WASM deep reader receives a browser file and duplicate/unknown/group arguments",async()=>{
 const input={name:"demo.png",size:125};
 let called=false;
 const result=await Bridge.scan(input,{loader:async()=>({parseMetadata:async(file,opts)=>{
  called=true;
  assert.equal(file,input);
  for(const flag of ["-json","-G4","-a","-u","-U","-struct"])assert.ok(opts.args.includes(flag));
  return {success:true,data:[testObject]};
 }})});
 assert.ok(called);
 assert.equal(result.engine,"ExifTool WASM (experimental)");
 assert.equal(result.fields.find(f=>f.name==="[MakerNotes]CameraUniqueID")?.value,"ABC");
 assert.match(result.warnings.join(" "),/SynthID/);
});
test("WASM errors are reported, not converted to empty metadata",async()=>{
 await assert.rejects(()=>Bridge.scan({name:"demo.png",size:12},{loader:async()=>({parseMetadata:async()=>({success:false,error:"unsupported compressed TIFF"})})}),/unsupported compressed TIFF/);
 await assert.rejects(()=>Bridge.scan({name:"demo.png",size:260*1048576},{loader:async()=>({})}),/256 MiB/);
});
async function waitFor(ok){
 for(let i=0;i<100;i++){if(ok())return;await new Promise(resolve=>setTimeout(resolve,25));}
 throw Error("Timed out waiting for ExifTool UI result");
}
test("Browser deep scan renders escaped ExifTool fields without breaking built-in inspector",async()=>{
 const dom=new JSDOM(read("index.html"),{url:"https://local.test/",runScripts:"outside-only"});
 const w=dom.window,d=w.document;
 try{
  w.TextDecoder=TextDecoder;w.TextEncoder=TextEncoder;
  Object.defineProperty(w.crypto,"subtle",{configurable:true,value:{digest:async()=>new ArrayBuffer(32)}});
  for(const x of ["zip-guard.js","formats-extra.js","universal-engine.js","metadata-extended.js","metadata-inspector.js","content-verifier.js","exiftool-bridge.js","universal-ui.js"])w.eval(read(x));
  const source=png();const input=d.getElementById("u-files");
  Object.defineProperty(input,"files",{configurable:true,value:[{name:"demo.png",size:source.length,type:"image/png",arrayBuffer:async()=>source.buffer.slice(0)}]});
  input.dispatchEvent(new w.Event("change"));
  await waitFor(()=>d.getElementById("u-progress").textContent.startsWith("Inspection finished."));
  w.FileMetaExifTool.scan=async()=>Bridge.normalize(testObject);
  d.getElementById("u-deep").click();
  await waitFor(()=>d.getElementById("u-progress").textContent.startsWith("ExifTool deep inspection completed:"));
  const deep=d.getElementById("u-exif-results");
  assert.match(deep.textContent,/DateTimeOriginal/);
  assert.match(deep.textContent,/ABC/);
  assert.match(deep.textContent,/<script>alert\(1\)<\/script>/);
  assert.equal(deep.querySelectorAll("script").length,0,"Never execute metadata as markup");
  const report=JSON.parse(d.getElementById("u-details").textContent)[0];
  assert.equal(report.status,"Inspected");
  assert.ok(report.deepInspection.fields.some(f=>f.name==="[MakerNotes]CameraUniqueID"));
  assert.match(report.synthIdDetection,/Not assessed/);
 }finally{dom.window.close();}
});
test("Browser imports matching ExifTool JSON in place of any WASM dependency",async()=>{
 const dom=new JSDOM(read("index.html"),{url:"https://local.test/",runScripts:"outside-only"});
 const w=dom.window,d=w.document;
 try{
  w.TextDecoder=TextDecoder;w.TextEncoder=TextEncoder;
  Object.defineProperty(w.crypto,"subtle",{configurable:true,value:{digest:async()=>new ArrayBuffer(32)}});
  for(const x of ["zip-guard.js","formats-extra.js","universal-engine.js","metadata-extended.js","metadata-inspector.js","content-verifier.js","exiftool-bridge.js","universal-ui.js"])w.eval(read(x));
  const source=png(),input=d.getElementById("u-files");
  Object.defineProperty(input,"files",{configurable:true,value:[{name:"demo.png",size:source.length,type:"image/png",arrayBuffer:async()=>source.buffer.slice(0)}]});
  input.dispatchEvent(new w.Event("change"));
  await waitFor(()=>d.getElementById("u-progress").textContent.startsWith("Inspection finished."));
  const json=a(JSON.stringify([testObject]));
  Object.defineProperty(d.getElementById("u-exif-json"),"files",{configurable:true,value:[{size:json.length,arrayBuffer:async()=>json.buffer.slice(0)}]});
  d.getElementById("u-exif-json").dispatchEvent(new w.Event("change"));
  await waitFor(()=>d.getElementById("u-progress").textContent.includes("Imported ExifTool JSON for"));
  const report=JSON.parse(d.getElementById("u-details").textContent)[0];
  assert.match(report.deepStatus,/Imported ExifTool JSON/);
  assert.equal(report.deepInspection.fields.find(f=>f.name==="[XMP]Creator")?.value,'["Alice","Bob"]');
 }finally{dom.window.close();}
});
