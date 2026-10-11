"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {JSDOM}=require("jsdom");
const root=path.resolve(__dirname,"..");
const read=name=>fs.readFileSync(path.join(root,name),"utf8");
test("Browser shell loads multi-file and legacy PDF modes without a backend",()=>{
 const html=read("index.html");
 for(const file of ["zip-guard.js","formats-extra.js","universal-engine.js","universal-ui.js"]){
  assert.ok(html.includes('<script src="'+file+'"></script>'),file);
 }
 assert.ok(html.indexOf("formats-extra.js")<html.indexOf("universal-engine.js"));
 assert.ok(html.indexOf("zip-guard.js")<html.indexOf("universal-engine.js"));
 const dom=new JSDOM(html,{url:"http://localhost:8080/",runScripts:"outside-only"});
 const w=dom.window;
 w.eval(read("universal-ui.js"));
 const d=w.document;
 assert.equal(d.getElementById("u-mode").getAttribute("aria-pressed"),"true");
 assert.equal(d.querySelector("main").style.display,"none");
 assert.ok(d.getElementById("u-clean").disabled);
 assert.ok(d.getElementById("u-cancel").disabled);
 d.getElementById("u-pdf-mode").click();
 assert.equal(d.getElementById("u-pdf-mode").getAttribute("aria-pressed"),"true");
 assert.notEqual(d.querySelector("main").style.display,"none");
 d.getElementById("u-mode").click();
 assert.equal(d.querySelector("main").style.display,"none");
 assert.equal(d.getElementById("u-details").textContent.trim(),"[]");
 assert.ok(d.getElementById("u-rows").textContent.includes("No files selected"));
 dom.window.close();
});
test("Client UI never says SynthID was successfully removed",()=>{
 const content=read("universal-ui.js");
 assert.ok(content.includes('synthIdDetection="Not assessed'));
 assert.ok(content.includes("NOT assessed"));
 assert.ok(content.includes("post-clean")||content.includes("Post-clean"));
});
