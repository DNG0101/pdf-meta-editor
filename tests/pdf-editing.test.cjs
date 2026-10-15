const {test}=require('node:test');
const assert=require('node:assert/strict');
const L=require('pdf-lib'),P=require('../pdf-tools.js'),V=require('../content-verifier.js');
async function sample(){const d=await L.PDFDocument.create();d.addPage().drawText('Keep content');d.setTitle('Old');d.setCreationDate(new Date('2020-01-01T00:00:00Z'));return d.save();}
test('PDF edits read back, dates delete, content graph is retained',async()=>{
 const a=await sample(),r=await P.edit(a,{title:'New తెలుగు',creationDate:'',modDate:'2026-10-15T12:30:00Z'},L),d=await L.PDFDocument.load(r.bytes,{updateMetadata:false});
 assert.equal(d.getTitle(),'New తెలుగు');assert.equal(d.getCreationDate(),undefined);assert.equal(d.getModificationDate().toISOString(),'2026-10-15T12:30:00.000Z');
 assert.equal((await V.verify(a,r.bytes,'pdf',{pdfLib:L})).level,'object-graph-and-streams');
});
test('Invalid/ambiguous calendar dates cannot silently export',async()=>{
 for(const value of ['tomorrow','2026-02-30T00:00:00Z','2026-10-15 12:30:00'])await assert.rejects(()=>P.edit(awaitable,{creationDate:value},L),/date|ISO/i);
});
// Each rejection must come from date validation with a real document.
let awaitable;test.before(async()=>{awaitable=await sample();});
test('Signed object and raw signature marker refuse editing',async()=>{
 const a=await sample(),d=await L.PDFDocument.load(a);d.context.register(d.context.obj({Type:'Sig',ByteRange:[0,1,2,3]}));
 const b=await d.save();await assert.rejects(()=>P.edit(b,{title:'x'},L),/signature/);
});
test('Custom Info strings update and null deletes without touching core fields',async()=>{
 const r=await P.edit(await sample(),{customInfoJSON:JSON.stringify({Department:'Engineering'})},L);
 const next=await P.edit(r.bytes,{customInfoJSON:'{"Department":null}'},L);
 const d=await L.PDFDocument.load(next.bytes,{updateMetadata:false});assert.equal(d.getTitle(),'Old');assert.equal(d.context.lookup(d.context.trailerInfo.Info).get(L.PDFName.of('Department')),undefined);
 await assert.rejects(()=>P.edit(r.bytes,{customInfoJSON:'{"Title":"bad"}'},L),/Reserved/);
});
test('Same-size pages with altered text fail graph verification',async()=>{
 const a=await sample(),d=await L.PDFDocument.load(a,{updateMetadata:false});d.getPage(0).drawText('Unexpected additional content');
 const b=await d.save();await assert.rejects(()=>V.verify(a,b,'pdf',{pdfLib:L}),/graph/);
});
