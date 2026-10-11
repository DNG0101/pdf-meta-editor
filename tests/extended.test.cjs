"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const JSZip=require("jszip");
global.FileMetaZipGuard=require("../zip-guard.js");
global.FileMetaExtraFormats=require("../formats-extra.js");
const E=require("../universal-engine.js");
const X=global.FileMetaExtraFormats;
const bytes=(...arrays)=>Uint8Array.from(arrays.flatMap(a=>Array.from(a)));
const str=s=>Uint8Array.from(Array.from(s,c=>c.charCodeAt(0)));
const sampleGIF=()=>{
 const loop=bytes([0x21,0xff,11],str("NETSCAPE2.0"),[3,1,0,0,0]);
 return bytes(str("GIF89a"),[1,0,1,0,0x80,0,0],[0,0,0,255,255,255],
 [0x21,0xfe,3,65,66,67,0],loop,
 [0x21,0xf9,4,0,0,0,0,0],[0x2c,0,0,0,0,1,0,1,0,0,2,2,0x4c,1,0,0x3b]);
};
const sampleFLAC=()=>bytes(str("fLaC"),[0,0,0,34],Array(34).fill(0),[4,0,0,4,1,2,3,4],[0x86,0,0,2,0x48,0x49],[255,248,0,1,2,3]);
test("GIF comments are removed while looping and frames remain",async()=>{
 const before=sampleGIF();
 const a=await E.process(before,"clip.gif",{remove:true});
 assert.equal(a.format,"gif");assert.equal(a.changed,true);assert.equal(a.count,1);
 const after=await E.process(a.bytes,"clip.gif");
 assert.equal(after.count,0);assert.equal(a.bytes[a.bytes.length-1],0x3b);
 assert.ok(a.bytes.length<before.length);
 assert.ok(Buffer.from(a.bytes).includes(Buffer.from("NETSCAPE2.0")));
});
test("GIF malformed image descriptors fail without output",()=>{
 const bad=sampleGIF().subarray(0,20);
 assert.throws(()=>X.gif(bad,true),/Truncated|Invalid|missing/);
});
test("FLAC metadata removed while audio payload is byte-preserved",async()=>{
 const a=sampleFLAC(),clean=await E.process(a,"audio.flac",{remove:true});
 assert.equal(clean.format,"flac");assert.equal(clean.count,2);
 assert.equal(clean.bytes[4],128);
 assert.deepEqual([...clean.bytes.slice(-6)],[255,248,0,1,2,3]);
 assert.equal((await E.process(clean.bytes,"audio.flac")).count,0);
});
test("FLAC invalid STREAMINFO cannot be rewritten",()=>{
 assert.throws(()=>X.flac(bytes(str("fLaC"),[0x80,0,0,34],Array(34).fill(0),[255,248]),true),/Invalid|Incomplete|missing/);
});
test("Read-only formats are detected but never marked cleaned",async()=>{
 const cases=[
  ["picture.tiff",[73,73,42,0]],["picture.bmp",[66,77,0,0]],
  ["music.ogg",[79,103,103,83]],["video.mp4",[0,0,0,12,102,116,121,112,105,115,111,109]],
  ["picture.avif",[0,0,0,12,102,116,121,112,97,118,105,102]],
  ["archive.gz",[31,139,8,0]],["binary.exe",[77,90,0,0]]
 ];
 for(const [name,raw]of cases){
  const r=await E.process(Uint8Array.from(raw),name,{remove:true});
  assert.equal(r.changed,false,name);
  assert.equal(r.supported,false,name);
  assert.notEqual(r.format,"unknown",name);
 }
});
test("Unknown content always fails closed even with a familiar extension",async()=>{
 const result=await E.process(str("not a pdf"),"fake.pdf",{remove:true});
 assert.equal(result.supported,false);assert.equal(result.changed,false);
});
test("ZIP preflight accepts bounded Office package",async()=>{
 const zip=new JSZip();
 zip.file("word/document.xml","<document/>");
 zip.file("docProps/core.xml","<properties/>");
 const data=await zip.generateAsync({type:"uint8array",compression:"DEFLATE"});
 const report=FileMetaZipGuard.preflight(data);
 assert.ok(report.entries>=2);
 const result=await E.process(data,"document.docx",{remove:true,zipLib:JSZip});
 assert.equal(result.changed,true);
 const check=await JSZip.loadAsync(result.bytes,{checkCRC32:true});
 assert.equal(check.file("docProps/core.xml"),null);
});
test("High-expansion ZIP is rejected BEFORE decompression",async()=>{
 const zip=new JSZip();zip.file("word/document.xml","A".repeat(2*1024*1024));
 const data=await zip.generateAsync({type:"uint8array",compression:"DEFLATE"});
 assert.throws(()=>FileMetaZipGuard.preflight(data),/ratio/);
 await assert.rejects(()=>E.process(data,"bomb.docx",{remove:true,zipLib:JSZip}),/ratio/);
});
test("ZIP with corrupted central directory fails closed",()=>{
 assert.throws(()=>FileMetaZipGuard.preflight(new Uint8Array([80,75,3,4,0,0])),/ZIP/);
});
test("JPEG malformed scan and trailing data are rejected",()=>{
 const hdr=Uint8Array.from([255,216,255,218,0,6,1,1,0,0,63,0]);
 assert.throws(()=>E.jpeg(bytes(hdr,[0,255,217,8]),true),/trailing|EOI/);
 assert.throws(()=>E.jpeg(bytes([255,216,255,218,0,2],[0,255,217]),true),/Invalid/);
});
test("Cleaned file results make no SynthID absence claim",async()=>{
 const clean=await E.process(sampleGIF(),"img.gif",{remove:true});
 assert.ok(!/synthid absent|watermark removed/i.test(JSON.stringify(clean)));
});
