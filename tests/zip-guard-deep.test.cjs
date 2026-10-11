"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict");
const JSZip=require("jszip"),guard=require("../zip-guard.js");
const le16=(a,p)=>a[p]|a[p+1]<<8,le32=(a,p)=>(a[p]|a[p+1]<<8|a[p+2]<<16|a[p+3]<<24)>>>0;
async function basic(){const z=new JSZip();z.file("word/document.xml","valid");z.file("docProps/core.xml","meta");return z.generateAsync({type:"uint8array",compression:"DEFLATE"});}
function central(a){for(let i=0;i<a.length-4;i++)if(le32(a,i)===0x02014b50)return i;throw Error("No central directory");}
test("Office ZIP with valid local/central headers passes preflight",async()=>assert.equal(guard.preflight(await basic()).entries,2));
test("Contradictory compression method is rejected",async()=>{
 const a=await basic(),p=central(a),bad=a.slice();bad[p+10]^=1;
 assert.throws(()=>guard.preflight(bad),/disagreement/);
});
test("Contradictory local header filename is rejected",async()=>{
 const a=await basic(),p=central(a),bad=a.slice(),offset=le32(a,p+42);
 bad[offset+30]^=1;
 assert.throws(()=>guard.preflight(bad),/filename differs/);
});
test("Contradictory CRC and uncompressed size are rejected",async()=>{
 const a=await basic(),p=central(a),bad=a.slice(),local=le32(a,p+42);
 bad[local+14]^=1;
 assert.throws(()=>guard.preflight(bad),/CRC disagreement/);
});
test("Overlapping local records are rejected",async()=>{
 const a=await basic(),bad=a.slice(),p=central(bad);
 // Two distinct directory records referring to the same local offset.
 const second=p+46+le16(bad,p+28)+le16(bad,p+30)+le16(bad,p+32);
 const local=le32(bad,p+42);
 bad[second+42]=local&255;bad[second+43]=local>>8&255;bad[second+44]=local>>16&255;bad[second+45]=local>>24&255;
 assert.throws(()=>guard.preflight(bad),/disagreement|overlap|filename differs/);
});
