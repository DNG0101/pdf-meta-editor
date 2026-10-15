/* Shared PDF safety, exact metadata editing and bounded object-graph diagnostics. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.FileMetaPDF=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const core={title:'Title',author:'Author',subject:'Subject',keywords:'Keywords',creator:'Creator',producer:'Producer',creationDate:'CreationDate',modDate:'ModDate'};
function guard(doc,bytes,lib){
 if(doc.isEncrypted||doc.context.trailerInfo.Encrypt)throw Error('Encrypted PDF: editing requires a supported decryption workflow; no output generated');
 let signature=false;
 for(const [,obj] of doc.context.enumerateIndirectObjects()){
  if(obj instanceof lib.PDFDict){
   const type=obj.get(lib.PDFName.of('Type')),ft=obj.get(lib.PDFName.of('FT'));
   if(String(type)==='/Sig'||String(ft)==='/Sig'||obj.has(lib.PDFName.of('ByteRange'))||obj.has(lib.PDFName.of('DocMDP')))signature=true;
  }
 }
 // Conservative fallback also covers unparsed revision/signature markers.
 const token=[47,66,121,116,101,82,97,110,103,101];
 for(let i=0;!signature&&i<=bytes.length-token.length;i++)if(token.every((x,j)=>bytes[i+j]===x))signature=true;
 if(signature)throw Error('Potential digital signature: refusing to invalidate the signed document');
}
async function snapshot(doc,lib,{excludeMetadata=true}={}){
 const seen=new Map(),streams=[];let nodes=0;
 function visit(value,depth){
  if(++nodes>200000||depth>160)throw Error('PDF graph verification safety limit reached; output withheld');
  if(value instanceof lib.PDFRef){
   const key=value.toString();if(seen.has(key))return ['ref',seen.get(key)];
   seen.set(key,seen.size);return ['object',seen.get(key),visit(doc.context.lookup(value),depth+1)];
  }
  if(value instanceof lib.PDFDict)return ['dict',value.entries().filter(([k])=>(!excludeMetadata||String(k)!=='/Metadata')).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))).map(([k,v])=>[String(k),visit(v,depth+1)])];
  if(value instanceof lib.PDFArray)return ['array',value.asArray().map(v=>visit(v,depth+1))];
  if(value&&value.dict&&typeof value.getContents==='function'){const record=['stream',visit(value.dict,depth+1),null];streams.push({record,bytes:value.getContents()});return record;}
  return value==null?null:String(value);
 }
 const graph=visit(doc.catalog,0);
 if(!globalThis.crypto?.subtle)throw Error('SHA-256 unavailable; PDF graph verification requires a secure context');
 for(const {record,bytes} of streams){const hash=await globalThis.crypto.subtle.digest('SHA-256',bytes);record[2]=[bytes.length,Array.from(new Uint8Array(hash),x=>x.toString(16).padStart(2,'0')).join('')];}
 return JSON.stringify(graph);
}
function inventory(doc,lib){
 const entries=[];
 for(const [ref,obj] of doc.context.enumerateIndirectObjects()){
  const dict=obj instanceof lib.PDFDict?obj:obj?.dict;
  if(!dict)continue;
  for(const [key,value] of dict.entries())if(['/Metadata','/EmbeddedFiles','/JavaScript','/OpenAction','/AA','/Annots','/AcroForm','/ByteRange','/Sig','/PieceInfo'].includes(String(key)))entries.push({object:ref.toString(),key:String(key),value:String(value).slice(0,300)});
  if(entries.length>5000)throw Error('PDF inventory exceeds 5000 diagnostic entries');
 }
 return {objects:doc.context.enumerateIndirectObjects().length,pages:doc.getPageCount(),entries,scope:'Parsed object inventory; signatures and compliance are not cryptographically validated'};
}
function dateValue(value,key){
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value))throw Error(key+': use UTC ISO format YYYY-MM-DDTHH:mm:ssZ, or clear to delete');
 const d=new Date(value);if(!Number.isFinite(d.getTime())||d.toISOString().replace('.000Z','Z')!==value.replace('.000Z','Z'))throw Error(key+': invalid calendar date');
 return d;
}
async function edit(bytes,changes,lib){
 const doc=await lib.PDFDocument.load(bytes,{updateMetadata:false});guard(doc,bytes,lib);
 const before=await snapshot(doc,lib,{excludeMetadata:false}),expected={};
 if(Object.hasOwn(changes,'customInfoJSON')){
  let custom;try{custom=JSON.parse(changes.customInfoJSON);}catch{throw Error('Custom Info must be valid JSON');}
  if(!custom||Array.isArray(custom)||typeof custom!=='object'||Object.keys(custom).length>200)throw Error('Custom Info must be an object with at most 200 fields');
  // Force creation of a valid Info dictionary only when needed.
  if(!doc.context.trailerInfo.Info){doc.setTitle('');doc.context.lookup(doc.context.trailerInfo.Info).delete(lib.PDFName.of('Title'));}
  const info=doc.context.lookup(doc.context.trailerInfo.Info);
  for(const [key,value] of Object.entries(custom)){
   if(Object.values(core).includes(key)||!key||key.length>200||/[\x00-\x1f]/.test(key))throw Error('Reserved or invalid custom Info key: '+key);
   if(value!==null&&(typeof value!=='string'||value.length>131072))throw Error('Custom values must be strings or null (delete)');
   if(value===null)info.delete(lib.PDFName.of(key));else info.set(lib.PDFName.of(key),lib.PDFHexString.fromText(value));
   expected[key]=value===null?null:String(info.get(lib.PDFName.of(key)));
  }
 }

 for(const [key,value] of Object.entries(changes)){
  if(key==='customInfoJSON')continue;
  if(!Object.hasOwn(core,key))throw Error('Unsupported editable field: '+key);
  if(typeof value!=='string'||value.length>131072)throw Error('Invalid or oversized metadata value: '+key);
  const name=lib.PDFName.of(core[key]);
  if(!value){const info=doc.context.lookup(doc.context.trailerInfo.Info);if(info instanceof lib.PDFDict)info.delete(name);expected[core[key]]=null;continue;}
  if(key==='creationDate'||key==='modDate'){
   const d=dateValue(value,key);if(key==='creationDate')doc.setCreationDate(d);else doc.setModificationDate(d);
  }else doc['set'+core[key]](key==='keywords'?value.split(/[,;\n]+/).map(v=>v.trim()).filter(Boolean):value);
  expected[core[key]]=String(doc.context.lookup(doc.context.trailerInfo.Info).get(name));
 }
 const output=await doc.save();const check=await lib.PDFDocument.load(output,{updateMetadata:false});
 if(await snapshot(check,lib,{excludeMetadata:false})!==before)throw Error('PDF catalog/content graph changed unexpectedly; output withheld');
 const info=check.context.lookup(check.context.trailerInfo.Info);
 for(const [key,value] of Object.entries(expected)){
  const actual=info?.get(lib.PDFName.of(key));
  if(value===null?actual!==undefined:String(actual)!==value)throw Error('Metadata readback mismatch: '+key);
 }
 return {bytes:output,diagnostics:{operation:'pdf-edit',changedFields:Object.keys(changes),verification:'Catalog graph and stream bytes compared; edited Info entries read back',inventory:inventory(check,lib),warnings:['Existing XMP is retained and may contain different values.','Rendering and cryptographic signature validation are not performed.']}};
}
return {guard,snapshot,inventory,edit,dateValue};
});
