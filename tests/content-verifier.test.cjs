"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict");
const {deflateSync}=require("node:zlib");
const JSZip=require("jszip"),PDFLib=require("pdf-lib");
const {JSDOM}=require("jsdom");
global.FileMetaZipGuard=require("../zip-guard.js");
global.FileMetaExtraFormats=require("../formats-extra.js");
const E=require("../universal-engine.js");global.FileMetaEngine=E;
const I=require("../metadata-inspector.js"),V=require("../content-verifier.js");
const dom=new JSDOM("").window;global.DOMParser=dom.DOMParser;global.XMLSerializer=dom.XMLSerializer;
const cat=(...a)=>Uint8Array.from(a.flatMap(b=>Array.from(b))),str=s=>Uint8Array.from([...s].map(c=>c.charCodeAt(0)));
const be=n=>Uint8Array.from([(n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255]),le=n=>Uint8Array.from([n&255,n>>>8&255,n>>>16&255,n>>>24&255]);
const seg=(m,b)=>cat([255,m,(b.length+2)>>8,(b.length+2)&255],b);
function crc(tag,b){let c=0xffffffff;for(const x of cat(str(tag),b)){c^=x;for(let i=0;i<8;i++)c=(c&1)?c>>>1^0xedb88320:c>>>1;}return cat(be(b.length),str(tag),b,be((c^0xffffffff)>>>0));}
const riff=(kind,...parts)=>{const b=cat(...parts);return cat(str("RIFF"),le(b.length+4),str(kind),b);};
const chunk=(tag,b)=>cat(str(tag),le(b.length),b,b.length&1?[0]:[]);
test("Multiscan JPEG metadata is removed even after entropy segments",async()=>{
 const a=cat([255,216],seg(225,str("early")),seg(218,[1,1,0,0,63,0]),[10,11,255,0,12,255,208,13],seg(225,str("late")),seg(218,[1,1,0,0,63,0]),[17,18,255,217]);
 const original=await I.inspect(a,"x.jpg"),clean=await E.process(a,"x.jpg",{remove:true}),after=await I.inspect(clean.bytes,"x.jpg");
 assert.equal(clean.count,2);assert.equal((await E.process(clean.bytes,"x.jpg")).count,0);
 assert.equal(original.fields.find(f=>f.name==="JPEG scans")?.value,"2");
 assert.equal(after.fields.find(f=>f.name==="JPEG scans")?.value,"2");
 assert.equal((await V.verify(a,clean.bytes,"jpeg")).preserved,true);
 const bad=clean.bytes.slice();bad[5]^=1;
 await assert.rejects(()=>V.verify(a,bad,"jpeg"),/JPEG|changed/);
});
test("PNG payload is verified and corruption is detected",async()=>{
 const a=cat([137,80,78,71,13,10,26,10],crc("IHDR",cat(be(4),be(6),[8,2,0,0,0])),crc("tEXt",str("Author\0Ada")),crc("IDAT",[7,8,9]),crc("IEND",[]));
 const b=(await E.process(a,"x.png",{remove:true})).bytes;
 assert.equal((await V.verify(a,b,"png")).preserved,true);
 const bad=b.slice(),tag=Buffer.from(bad).indexOf("IDAT");bad[tag+4]^=1;
 await assert.rejects(()=>V.verify(a,bad,"png"),/changed/);
 const invalid=cat([137,80,78,71,13,10,26,10],crc("IDAT",[1]),crc("IEND",[]));
 await assert.rejects(()=>V.verify(invalid,invalid,"png"),/IHDR/);
});
test("MP3 audio payload is unchanged",async()=>{
 const a=cat(str("ID3"),[4,0,0,0,0,0,0],[255,251,32,4,9],str("TAG"),new Uint8Array(125));
 const b=(await E.process(a,"x.mp3",{remove:true})).bytes;
 assert.equal((await V.verify(a,b,"mp3")).preserved,true);
 await assert.rejects(()=>V.verify(a,cat(b,[0]),"mp3"),/size differs/);
});
test("WAV and WebP media bytes remain unchanged",async()=>{
 const wav=riff("WAVE",chunk("fmt ",[1,0,1,0,68,172,0,0,0,0,0,0,2,0,16,0]),chunk("LIST",str("INFO")),chunk("data",[1,2,3,4]));
 const out=(await E.process(wav,"x.wav",{remove:true})).bytes;
 assert.equal((await V.verify(wav,out,"wav")).preserved,true);
 const webp=riff("WEBP",chunk("VP8X",[12,0,0,0,1,0,0,1,0,0]),chunk("VP8 ",[1,2,3]),chunk("XMP ",str("Private")));
 const output=(await E.process(webp,"x.webp",{remove:true})).bytes;
 assert.equal((await V.verify(webp,output,"webp")).preserved,true);
});
test("GIF frames and FLAC samples are byte-preserved",async()=>{
 const gif=cat(str("GIF89a"),[1,0,1,0,128,0,0],[0,0,0,255,255,255],[33,254,3,65,66,67,0],[44,0,0,0,0,1,0,1,0,0,2,2,76,1,0,59]);
 assert.equal((await V.verify(gif,(await E.process(gif,"x.gif",{remove:true})).bytes,"gif")).preserved,true);
 const flac=cat(str("fLaC"),[0,0,0,34],new Uint8Array(34),[132,0,0,2,1,2],[255,248,0,1]);
 assert.equal((await V.verify(flac,(await E.process(flac,"x.flac",{remove:true})).bytes,"flac")).preserved,true);
});
test("PDF validation honestly checks structure, not rendering",async()=>{
 const d=await PDFLib.PDFDocument.create();d.addPage([170,212]);d.setAuthor("Private");
 const a=new Uint8Array(await d.save()),b=(await E.process(a,"x.pdf",{remove:true,pdfLib:PDFLib})).bytes;
 const check=await V.verify(a,b,"pdf",{pdfLib:PDFLib});assert.equal(check.level,"object-graph-and-streams");
 const altered=await PDFLib.PDFDocument.load(b,{updateMetadata:false});altered.getPage(0).setSize(220,212);
 const changed=new Uint8Array(await altered.save());
 await assert.rejects(()=>V.verify(a,changed,"pdf",{pdfLib:PDFLib}),/geometry/);
});
test("Office entries are compared by actual uncompressed bytes",async()=>{
 const zip=new JSZip();zip.file("word/document.xml","<doc>Keep this</doc>");zip.file("docProps/core.xml","<props>Remove this</props>");
 const a=await zip.generateAsync({type:"uint8array",compression:"DEFLATE"});
 const b=(await E.process(a,"x.docx",{remove:true,zipLib:JSZip})).bytes;
 assert.equal((await V.verify(a,b,"docx",{zipLib:JSZip})).preserved,true);
 const broken=await JSZip.loadAsync(b);broken.file("word/document.xml","<doc>Changed!</doc>");
 const tampered=await broken.generateAsync({type:"uint8array",compression:"DEFLATE"});
 await assert.rejects(()=>V.verify(a,tampered,"docx",{zipLib:JSZip}),/changed|differs/);
});
test("Unknown files cannot be certified",async()=>{
 await assert.rejects(()=>V.verify(str("hello"),str("hello"),"unknown"),/No content preservation verifier/);
});

test("PNG zTXt and compressed iTXt reveal real metadata values and then cleanly disappear",async()=>{
 const txt=str("Encoded author"),compressed=deflateSync(txt);
 const z=cat(str("Author"),[0,0],compressed);
 const intl=cat(str("Description"),[0,1,0,0,0],compressed);
 const a=cat([137,80,78,71,13,10,26,10],
  crc("IHDR",cat(be(2),be(2),[8,2,0,0,0])),
  crc("zTXt",z),crc("iTXt",intl),crc("IDAT",[1,2]),crc("IEND",[]));
 const before=await I.inspect(a,"compressed.png");
 assert.equal(before.fields.find(x=>x.name==="Author")?.value,"Encoded author");
 assert.equal(before.fields.find(x=>x.name==="Description")?.value,"Encoded author");
 const b=(await E.process(a,"compressed.png",{remove:true})).bytes;
 const after=await I.inspect(b,"compressed.png");
 assert.equal(after.fields.some(x=>x.name==="Author"||x.name==="Description"),false);
 assert.equal((await V.verify(a,b,"png")).preserved,true);
});
