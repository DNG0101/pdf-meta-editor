"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const JSZip=require("jszip");
const PDFLib=require("pdf-lib");
const {JSDOM}=require("jsdom");
global.FileMetaZipGuard=require("../zip-guard.js");
global.FileMetaExtraFormats=require("../formats-extra.js");
global.FileMetaEngine=require("../universal-engine.js");
const I=require("../metadata-inspector.js");
const x=new JSDOM("").window;
global.DOMParser=x.DOMParser;global.XMLSerializer=x.XMLSerializer;
const text=s=>new TextEncoder().encode(s);
const join=(...xs)=>Uint8Array.from(xs.flatMap(v=>Array.from(v)));
const be=n=>Uint8Array.from([(n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255]);
const le=n=>Uint8Array.from([n&255,(n>>>8)&255,(n>>>16)&255,(n>>>24)&255]);
function pngChunk(type,v){
 let crc=0xffffffff;for(const z of join(text(type),v)){crc^=z;for(let j=0;j<8;j++)crc=(crc&1)?((crc>>>1)^0xedb88320):(crc>>>1);}
 return join(be(v.length),text(type),v,be((crc^0xffffffff)>>>0));
}
const png=(...chunks)=>join([137,80,78,71,13,10,26,10],...chunks);
function jpegExif(){
 // Little-endian TIFF: Make="Nikon"; Orientation=1
 const tiff=join(text("II"),[42,0],[8,0,0,0],[2,0],
 [0x0f,1,2,0,6,0,0,0,38,0,0,0],
 [0x12,1,3,0,1,0,0,0,1,0,0,0],
 [0,0,0,0],text("Nikon\0"));
 return join([255,216,255,225,0,tiff.length+8],text("Exif\0\0"),tiff,[255,218,0,6,1,1,0,0,63,0,0,255,217]);
}
test("JPEG inspector extracts EXIF camera make and orientation",async()=>{
 const info=await I.inspect(jpegExif(),"photo.jpeg");
 assert.equal(info.format,"jpeg");
 assert.equal(info.fields.find(f=>f.name==="IFD0 Make")?.value,"Nikon");
 assert.equal(info.fields.find(f=>f.name==="IFD0 Orientation")?.value,"1");
 assert.ok(info.coverage.startsWith("Partial"));
});
test("PNG inspector extracts actual text fields and image dimensions",async()=>{
 const header=join(be(32),be(64),[8,2,0,0,0]);
 const data=png(pngChunk("IHDR",header),pngChunk("tEXt",text("Author\0Example Author")),pngChunk("IDAT",Uint8Array.from([1,2,3])),pngChunk("IEND",new Uint8Array()));
 const info=await I.inspect(data,"pic.png");
 assert.equal(info.fields.find(f=>f.name==="Author")?.value,"Example Author");
 assert.equal(info.fields.find(f=>f.name==="Width")?.value,"32");
 assert.equal(info.fields.find(f=>f.name==="Height")?.value,"64");
 const clean=await FileMetaEngine.process(data,"pic.png",{remove:true});
 assert.equal(clean.changed,true);
 const after=await I.inspect(clean.bytes,"pic.png");
 assert.equal(after.fields.some(f=>f.name==="Author"),false);
 assert.equal(after.fields.find(f=>f.name==="Width")?.value,"32");
});
test("MP3 inspector extracts ID3v2 title/artist and cleans supported tags",async()=>{
 const tag=join(text("TIT2"),be(6),[0,0,3],text("Song!"));
 const input=join(text("ID3"),[3,0,0,0,0,0,16],tag,[255,251,128,100]);
 const info=await I.inspect(input,"music.mp3");
 assert.equal(info.fields.find(f=>f.name==="Title")?.value,"Song!");
 const c=await FileMetaEngine.process(input,"music.mp3",{remove:true});
 assert.equal(c.changed,true);
 assert.equal((await I.inspect(c.bytes,"music.mp3")).fields.some(f=>f.name==="Title"),false);
});
test("WAV INFO inspector extracts artist and retains samples after cleanup",async()=>{
 const riff=(kind,parts)=>{const body=join(...parts);return join(text("RIFF"),le(body.length+4),text(kind),body);};
 const chunk=(kind,payload)=>join(text(kind),le(payload.length),payload,payload.length%2?[0]:[]);
 const list=chunk("LIST",join(text("INFO"),chunk("IART",text("Songbird\0"))));
 const data=chunk("data",Uint8Array.from([1,2,3,4]));
 const audio=riff("WAVE",[list,chunk("fmt ",Uint8Array.from([1,0,2,0,68,172,0,0,0,0,0,0,0,0,0,0])),data]);
 const info=await I.inspect(audio,"audio.wav");
 assert.equal(info.fields.find(f=>f.name==="IART")?.value,"Songbird");
 assert.equal(info.fields.find(f=>f.name==="Channels")?.value,"2");
 const clean=await FileMetaEngine.process(audio,"audio.wav",{remove:true});
 assert.deepEqual([...clean.bytes.slice(-4)],[1,2,3,4]);
});
test("FLAC inspector reads real Vorbis tags",async()=>{
 const vendor=text("libFLAC"),entry=text("ARTIST=Studio Test");
 const block=join(le(vendor.length),vendor,le(1),le(entry.length),entry);
 const a=join(text("fLaC"),[0,0,0,34],new Uint8Array(34),[0x84,0,0,block.length],block,[255,248]);
 const info=await I.inspect(a,"test.flac");
 assert.equal(info.fields.find(f=>f.name==="ARTIST")?.value,"Studio Test");
 const clean=await FileMetaEngine.process(a,"test.flac",{remove:true});
 assert.equal((await I.inspect(clean.bytes,"test.flac")).fields.some(f=>f.name==="ARTIST"),false);
});
test("PDF inspector returns actual properties and detects their removal",async()=>{
 const d=await PDFLib.PDFDocument.create();d.addPage([100,110]);d.setAuthor("Visible Author");d.setTitle("Test PDF");
 const b=new Uint8Array(await d.save());
 const before=await I.inspect(b,"document.pdf",{pdfLib:PDFLib});
 assert.equal(before.fields.find(f=>f.name==="Author")?.value,"Visible Author");
 assert.equal(before.fields.find(f=>f.name==="Pages")?.value,"1");
 const c=await FileMetaEngine.process(b,"document.pdf",{remove:true,pdfLib:PDFLib});
 const after=await I.inspect(c.bytes,"document.pdf",{pdfLib:PDFLib});
 assert.equal(after.fields.some(f=>f.name==="Author"),false);
 assert.equal(after.fields.find(f=>f.name==="Pages")?.value,"1");
});
test("DOCX inspector reads creator from docProps, then cleans it",async()=>{
 const zip=new JSZip();zip.file("word/document.xml","<w:document/>");
 zip.file("docProps/core.xml",'<cp:coreProperties xmlns:cp="urn:core" xmlns:dc="urn:dc"><dc:creator>Jane Writer</dc:creator><cp:lastModifiedBy>Editor</cp:lastModifiedBy></cp:coreProperties>');
 const b=await zip.generateAsync({type:"uint8array",compression:"DEFLATE"});
 const info=await I.inspect(b,"text.docx",{zipLib:JSZip});
 assert.equal(info.fields.find(f=>f.name==="creator")?.value,"Jane Writer");
 const cleaned=await FileMetaEngine.process(b,"text.docx",{remove:true,zipLib:JSZip});
 const after=await I.inspect(cleaned.bytes,"text.docx",{zipLib:JSZip});
 assert.equal(after.fields.some(f=>f.name==="creator"),false);
});
test("Malformed EXIF offsets fail instead of inventing data",async()=>{
 const jpeg=jpegExif();jpeg[30]=255; // corrupt TIFF Make offset (byte 0 of LE uint32)
 assert.throws(()=>I.inspect(jpeg,"bad.jpg"),/EXIF/);
});
test("Unrecognized files never claim universal inspection or invisible watermark checks",async()=>{
 const info=await I.inspect(text("hello, world"),"any.bin");
 assert.equal(info.format,"unknown");assert.deepEqual(info.fields,[]);
 assert.match(info.coverage,/Partial/);assert.match(info.watermarkStatus,/Not assessed/);
});
