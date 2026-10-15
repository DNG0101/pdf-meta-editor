/* Real Chromium integration, including the external ExifTool runtime. */
const {chromium}=require('playwright');
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');
const assert=require('node:assert/strict'),PDF=require('pdf-lib');
(async()=>{
 const root=path.resolve(__dirname,'..');
 const server=http.createServer(async(req,res)=>{
  try{const pathname=new URL(req.url,'http://localhost').pathname;const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));if(!file.startsWith(root+path.sep))throw Error('outside root');const bytes=await fs.readFile(file);res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':'application/octet-stream');res.end(bytes);}catch{res.writeHead(404);res.end('Not found');}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  const page=await browser.newPage();page.setDefaultTimeout(30000);
  // Use the exact installed versions of these unchanged CDN dependencies.
  await page.route('https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js',r=>r.fulfill({path:path.join(root,'node_modules/pdf-lib/dist/pdf-lib.min.js'),contentType:'text/javascript'}));
  await page.route('https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',r=>r.fulfill({path:path.join(root,'node_modules/jszip/dist/jszip.min.js'),contentType:'text/javascript'}));
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.waitForFunction(()=>window.FileMetaPDF&&window.FileMetaEngine&&window.FileMetaExifTool);
  const doc=await PDF.PDFDocument.create();doc.addPage().drawText('Preserve this content');doc.setAuthor('Private Author');doc.setCreationDate(new Date('2020-01-01T00:00:00Z'));const bytes=Buffer.from(await doc.save());
  await page.locator('#u-files').setInputFiles({name:'sample.pdf',mimeType:'application/pdf',buffer:bytes});
  await page.waitForFunction(()=>document.querySelector('#u-progress').textContent.startsWith('Inspection finished.'));
  const cleanup=page.waitForEvent('download');await page.locator('#u-clean').click();const cleaned=await cleanup;
  const output=await fs.readFile(await cleaned.path());const reopened=await PDF.PDFDocument.load(output,{updateMetadata:false});assert.equal(reopened.getAuthor(),undefined);
  await page.locator('#u-pdf-mode').click();await page.locator('#file-input').setInputFiles({name:'sample.pdf',mimeType:'application/pdf',buffer:bytes});
  await page.locator('[data-key="author"] input').fill('Updated Author');
  await page.locator('[data-key="creationDate"] input').fill('');
  await page.locator('[data-key="customInfoJSON"] textarea').fill('{"Department":"Engineering"}');
  const edit=page.waitForEvent('download');await page.locator('#btn-download').click();const edited=await edit;
  const check=await PDF.PDFDocument.load(await fs.readFile(await edited.path()),{updateMetadata:false});assert.equal(check.getAuthor(),'Updated Author');assert.equal(check.getCreationDate(),undefined);
  await page.locator('[data-key="creationDate"] input').fill('2026-02-30T00:00:00Z');await page.locator('#btn-download').click();await page.waitForFunction(()=>document.body.textContent.includes('invalid calendar date'));
  await page.locator('#u-mode').click();
  const gif=Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==','base64');
  await page.locator('#u-files').setInputFiles({name:'sample.gif',mimeType:'image/gif',buffer:gif});
  await page.waitForFunction(()=>document.querySelector('#u-progress').textContent.startsWith('Inspection finished.'));
  await page.locator('#u-deep').click();
  await page.waitForFunction(()=>document.querySelector('#u-progress').textContent.startsWith('ExifTool deep inspection completed:'),{},{timeout:150000});
  const report=JSON.parse(await page.locator('#u-details').textContent())[0];assert.equal(report.deepStatus,'ExifTool extracted',JSON.stringify(report));assert.ok(report.deepInspection.fields.length>0);
  console.log('PASS: real Chromium PDF cleanup/edit/date validation and real ExifTool worker GIF scan');
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
