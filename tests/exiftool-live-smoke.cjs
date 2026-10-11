"use strict";
const crypto=require("node:crypto");
const Bridge=require("../exiftool-bridge.js");
(async()=>{
 const result=await Bridge.fetchCheckedWasm({
  fetchImpl:(url,options)=>fetch(url,{...options,signal:AbortSignal.timeout(30000)})
 });
 const binary=result.binary;
 const sha256=crypto.createHash("sha256").update(Buffer.from(binary)).digest("hex");
 console.log("Verified actual WASM asset provider:",result.url);
 console.log("Verified WASM bytes:",binary.byteLength);
 console.log("Verified SHA-256:",sha256);
 if(binary.byteLength<1024*1024)throw Error("Downloaded WASM suspiciously small: "+binary.byteLength);
})().catch(err=>{console.error(err);process.exitCode=1;});
