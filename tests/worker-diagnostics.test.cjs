const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom');
test('Exif worker cancellation terminates work and permits another scan',async()=>{
 const dom=new JSDOM('',{url:'https://example.test/editor/',runScripts:'outside-only'}),w=dom.window;
 let active;
 w.Worker=class {constructor(){active=this;}postMessage(){}terminate(){this.stopped=true;}};
 w.eval(fs.readFileSync('exiftool-bridge.js','utf8'));
 const pending=w.FileMetaExifTool.scan({name:'x.pdf',size:3});w.FileMetaExifTool.cancel();
 await assert.rejects(()=>pending,/canceled/);assert.equal(active.stopped,true);
 const next=w.FileMetaExifTool.scan({name:'x.pdf',size:3});active.onmessage({data:{result:{fields:[]}}});await next;assert.equal(active.stopped,true);w.close();
});
test('Debug events are bounded and do not copy arbitrary metadata values',()=>{
 const dom=new JSDOM('',{runScripts:'outside-only'}),w=dom.window;
 w.eval(fs.readFileSync('diagnostics.js','utf8'));
 for(let i=0;i<250;i++)w.FileMetaDiagnostics.record('test',{status:'ok',metadata:'private metadata'});
 const report=w.FileMetaDiagnostics.report();assert.equal(report.events.length,200);assert.ok(!JSON.stringify(report).includes('private metadata'));w.close();
});
