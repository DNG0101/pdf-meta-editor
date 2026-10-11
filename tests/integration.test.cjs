"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const JSZip=require("jszip");
const PDFLib=require("pdf-lib");
const {JSDOM}=require("jsdom");
global.FileMetaZipGuard=require("../zip-guard.js");
global.FileMetaExtraFormats=require("../formats-extra.js");
const E=require("../universal-engine.js");
const xmlDom=new JSDOM("").window;
global.DOMParser=xmlDom.DOMParser;
global.XMLSerializer=xmlDom.XMLSerializer;

test("PDF Info properties are removed and page integrity survives rewrite",async()=>{
 const doc=await PDFLib.PDFDocument.create();
 doc.addPage([240,300]);doc.setTitle("Confidential Example");doc.setAuthor("Hidden Author");
 doc.setSubject("Classified");doc.setKeywords(["internal","sample"]);
 const input=new Uint8Array(await doc.save());
 const inspected=await E.process(input,"sample.pdf",{pdfLib:PDFLib});
 assert.equal(inspected.format,"pdf");assert.ok(inspected.count>=1);
 const cleaned=await E.process(input,"sample.pdf",{remove:true,pdfLib:PDFLib});
 assert.equal(cleaned.changed,true);
 const check=await E.process(cleaned.bytes,"sample.pdf",{pdfLib:PDFLib});
 assert.equal(check.count,0);
 const reopened=await PDFLib.PDFDocument.load(cleaned.bytes,{updateMetadata:false});
 assert.equal(reopened.getPageCount(),1);
 assert.equal(reopened.context.trailerInfo.Info,undefined);
 assert.equal(reopened.getTitle(),undefined);
 assert.equal(reopened.getAuthor(),undefined);
});
test("Signed PDF marker causes fail-closed response",async()=>{
 const doc=await PDFLib.PDFDocument.create();doc.addPage([200,200]);
 const original=new Uint8Array(await doc.save());
 // Appending a marker in an incremental-looking tail is enough to force rejection.
 const marker=new TextEncoder().encode("\n% /ByteRange []\n");
 const bytes=new Uint8Array(original.length+marker.length);bytes.set(original);
 bytes.set(marker,original.length);
 await assert.rejects(()=>E.process(bytes,"signed.pdf",{remove:true,pdfLib:PDFLib}),/signature/i);
});
test("DOCX properties and relationships are physically removed",async()=>{
 const z=new JSZip();
 z.file("word/document.xml",'<?xml version="1.0"?><w:document xmlns:w="urn:w"/>');
 z.file("docProps/core.xml",'<properties><creator>Private Author</creator></properties>');
 z.file("docProps/app.xml",'<Properties><Application>Private App</Application></Properties>');
 z.file("_rels/.rels",'<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="r2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
 z.file("[Content_Types].xml",'<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/word/document.xml" ContentType="application/xml"/></Types>');
 const original=await z.generateAsync({type:"uint8array"});
 const output=await E.process(original,"private.docx",{remove:true,zipLib:JSZip});
 assert.equal(output.format,"docx");assert.equal(output.count,2);
 assert.equal(output.changed,true);
 const reopened=await JSZip.loadAsync(output.bytes,{checkCRC32:true});
 assert.equal(reopened.file("docProps/core.xml"),null);
 assert.equal(reopened.file("docProps/app.xml"),null);
 assert.ok(reopened.file("word/document.xml"));
 const relationship=await reopened.file("_rels/.rels").async("string");
 assert.ok(!relationship.includes("core-properties"));
 assert.ok(relationship.includes("officeDocument"));
 const recheck=await E.process(output.bytes,"private.docx",{zipLib:JSZip});
 assert.equal(recheck.count,0);
});
test("Signed OOXML package is rejected rather than rewritten",async()=>{
 const zip=new JSZip();
 zip.file("word/document.xml","<document/>");
 zip.file("docProps/core.xml","<properties/>");
 zip.file("_xmlsignatures/sig1.xml","<Signature/>");
 const data=await zip.generateAsync({type:"uint8array"});
 await assert.rejects(()=>E.process(data,"signed.docx",{remove:true,zipLib:JSZip}),/signed Office/i);
});
