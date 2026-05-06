"use strict";

// ── pdfjs setup ───────────────────────────────────────────────────────────────
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

// ── State ─────────────────────────────────────────────────────────────────────
let currentBytes   = null;
let currentFileName = "";
let originalFields = {};   // { key: original string value (or "") }
let editedFields   = {};   // { key: current edited value } — only keys user changed

// ── Drag-and-drop ─────────────────────────────────────────────────────────────
const dropzone = document.getElementById("dropzone");
dropzone.addEventListener("dragover",  (e) => { e.preventDefault(); dropzone.classList.add("drag-over"); });
dropzone.addEventListener("dragleave", ()  => dropzone.classList.remove("drag-over"));
dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("drag-over");
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
});

// ── Entry point ───────────────────────────────────────────────────────────────
async function handleFile(file) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
    showToast("Please upload a PDF file.", "error"); return;
  }
  show("loading-area"); hide("upload-area"); hide("results-area");
  document.getElementById("header-actions").style.display = "none";
  currentBytes = null; currentFileName = file.name;
  editedFields = {}; originalFields = {};

  try {
    const buf = await file.arrayBuffer();
    currentBytes = new Uint8Array(buf);
    const sections = await buildSections(file, buf);
    renderResults(file.name, sections);
    show("results-area"); hide("loading-area");
    document.getElementById("header-actions").style.display = "flex";
    showToast(`${sections.length} metadata categories extracted.`, "success");
  } catch (err) {
    hide("loading-area"); show("upload-area");
    showToast("Failed to analyse PDF: " + err.message, "error");
    console.error(err);
  }
}

// ── Build all metadata sections ───────────────────────────────────────────────
// Every field: { key, label, value, type?, pdfWritable? }
// pdfWritable = true  → value gets embedded in the downloaded PDF
// All fields are shown as editable inputs regardless.
async function buildSections(file, buf) {
  const bytes   = new Uint8Array(buf);
  const rawText = bytesToLatin1(bytes);

  // Hashes
  const [sha1Buf, sha256Buf] = await Promise.all([
    crypto.subtle.digest("SHA-1",   buf),
    crypto.subtle.digest("SHA-256", buf),
  ]);
  const md5hash    = computeMD5(bytes);
  const sha1hash   = bufToHex(sha1Buf);
  const sha256hash = bufToHex(sha256Buf);

  // PDF header version
  const headerMatch = rawText.slice(0, 20).match(/%PDF-(\d+\.\d+)/);
  const pdfVersion  = headerMatch ? headerMatch[1] : "";

  // pdf-lib
  let libDoc = null;
  try { libDoc = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true }); } catch {}

  // pdfjs
  let pjsDoc = null;
  try { pjsDoc = await pdfjsLib.getDocument({ data: bytes.slice() }).promise; } catch {}

  // ── Core metadata ─────────────────────────────────────────────────────────
  let title="", author="", subject="", keywords="",
      creator="", producer="", creationDate="", modDate="";

  if (libDoc) {
    title        = or(libDoc.getTitle());
    author       = or(libDoc.getAuthor());
    subject      = or(libDoc.getSubject());
    keywords     = or(libDoc.getKeywords());
    creator      = or(libDoc.getCreator());
    producer     = or(libDoc.getProducer());
    creationDate = fmtDate(libDoc.getCreationDate());
    modDate      = fmtDate(libDoc.getModificationDate());
  }
  if (pjsDoc) {
    try {
      const meta = await pjsDoc.getMetadata();
      const info = meta.info || {};
      if (!title)        title        = or(info.Title);
      if (!author)       author       = or(info.Author);
      if (!subject)      subject      = or(info.Subject);
      if (!keywords)     keywords     = or(info.Keywords);
      if (!creator)      creator      = or(info.Creator);
      if (!producer)     producer     = or(info.Producer);
      if (!creationDate) creationDate = parsePdfDate(info.CreationDate);
      if (!modDate)      modDate      = parsePdfDate(info.ModDate);
    } catch {}
  }

  // ── Structure ─────────────────────────────────────────────────────────────
  let pageCount = "";
  const pageDims = [];
  if (pjsDoc) {
    pageCount = String(pjsDoc.numPages);
    for (let i = 1; i <= Math.min(pjsDoc.numPages, 8); i++) {
      try {
        const page = await pjsDoc.getPage(i);
        const vp   = page.getViewport({ scale: 1 });
        const ori  = vp.width > vp.height ? "Landscape" : "Portrait";
        pageDims.push(`Page ${i}: ${vp.width.toFixed(0)}×${vp.height.toFixed(0)} pt  (${(vp.width/72).toFixed(2)}"×${(vp.height/72).toFixed(2)}")  —  ${ori}`);
      } catch {}
    }
    if (pjsDoc.numPages > 8) pageDims.push(`… and ${pjsDoc.numPages - 8} more pages`);
  } else if (libDoc) {
    pageCount = String(libDoc.getPageCount());
    libDoc.getPages().slice(0, 8).forEach((p, i) => {
      const { width, height } = p.getSize();
      pageDims.push(`Page ${i+1}: ${width.toFixed(0)}×${height.toFixed(0)} pt — ${width>height?"Landscape":"Portrait"}`);
    });
  }
  const eofCount    = (rawText.match(/%%EOF/g) || []).length;
  const isLinearized = rawText.includes("/Linearized") ? "Yes" : "No";

  // ── Security ──────────────────────────────────────────────────────────────
  let isEncrypted = rawText.includes("/Encrypt") ? "Yes" : "No";
  let encAlgo = "";
  if (isEncrypted === "Yes") {
    const vm = rawText.match(/\/V\s+(\d)/);
    if (vm) {
      const algMap = { 1:"RC4 40-bit", 2:"RC4 128-bit", 4:"AES 128-bit", 5:"AES 256-bit" };
      encAlgo = algMap[parseInt(vm[1])] || `Version ${vm[1]}`;
    }
  }
  let printPerm="", copyPerm="", editPerm="";
  if (pjsDoc) {
    try {
      const perms = await pjsDoc.getPermissions();
      if (perms) {
        printPerm = perms.includes(4)  ? "Allowed" : "Restricted";
        copyPerm  = perms.includes(16) ? "Allowed" : "Restricted";
        editPerm  = perms.includes(8)  ? "Allowed" : "Restricted";
      } else {
        printPerm = copyPerm = editPerm = "Allowed (no restrictions)";
      }
    } catch {}
  }
  const secHandler  = (rawText.match(/\/Filter\s*\/(\w+)/) || [])[1] || "";
  const metaEncrypt = rawText.includes("/EncryptMetadata") ? "Yes" : "No";

  // ── Signatures ────────────────────────────────────────────────────────────
  const sigMatches = rawText.match(/\/Type\s*\/Sig/g) || [];
  const sigExists  = sigMatches.length > 0 ? "Yes" : "No";
  const sigReason  = (rawText.match(/\/Reason\s*\(([^)]+)\)/) || [])[1] || "";
  const sigLocation= (rawText.match(/\/Location\s*\(([^)]+)\)/) || [])[1] || "";
  const sigContact = (rawText.match(/\/ContactInfo\s*\(([^)]+)\)/) || [])[1] || "";

  // ── Creator/Producer fingerprints ─────────────────────────────────────────
  const fpMap = [
    [/adobe\s+acrobat/i,       "Adobe Acrobat"],
    [/adobe\s+distiller/i,     "Adobe Distiller"],
    [/photoshop/i,             "Adobe Photoshop"],
    [/canva/i,                 "Canva"],
    [/microsoft\s+word/i,      "Microsoft Word"],
    [/libreoffice/i,           "LibreOffice"],
    [/wps\s+office/i,          "WPS Office"],
    [/google\s+docs/i,         "Google Docs"],
    [/ilovepdf/i,              "iLovePDF"],
    [/smallpdf/i,              "SmallPDF"],
    [/pdf24/i,                 "PDF24"],
    [/pdfcreator/i,            "PDFCreator"],
    [/nitro/i,                 "Nitro PDF"],
    [/foxit/i,                 "Foxit"],
    [/quartz\s+pdfcontext/i,   "macOS Quartz (Print to PDF)"],
    [/skia/i,                  "Skia (Chrome/Chromium)"],
    [/fpdf/i,                  "FPDF library"],
    [/reportlab/i,             "ReportLab (Python)"],
    [/itext/i,                 "iText library"],
    [/tcpdf/i,                 "TCPDF library"],
  ];
  const combined = [title, author, creator, producer, rawText.slice(0, 4096)].join(" ");
  const fingerprints = fpMap.filter(([re]) => re.test(combined)).map(([,l]) => l);
  const exportEngine = (rawText.match(/\/Producer\s*\(([^)]+)\)/) || [])[1] || "";

  // ── Fonts ─────────────────────────────────────────────────────────────────
  const fontNames = new Set();
  if (pjsDoc) {
    try {
      for (let i = 1; i <= pjsDoc.numPages; i++) {
        const page = await pjsDoc.getPage(i);
        const ops  = await page.getOperatorList();
        ops.fnArray.forEach((fn, j) => {
          if (fn === pdfjsLib.OPS.setFont && ops.argsArray[j]?.[0])
            fontNames.add(String(ops.argsArray[j][0]));
        });
      }
    } catch {}
  }
  const fontTypeSet = new Set(
    (rawText.match(/\/Subtype\s*\/(TrueType|Type1|CIDFontType[012]|OpenType|Type0)/g) || [])
      .map(m => m.replace(/\/Subtype\s*\//, ""))
  );
  const embeddedFontCount = (rawText.match(/\/FontFile/g) || []).length;

  // ── Images ────────────────────────────────────────────────────────────────
  const imgCount = (rawText.match(/\/Subtype\s*\/Image/g) || []).length;
  const hasJpeg  = rawText.includes("/DCTDecode")    ? "Yes" : "No";
  const hasFlate = rawText.includes("/FlateDecode")  ? "Yes" : "No";
  const hasJpeg2 = rawText.includes("/JPXDecode")    ? "Yes" : "No";
  const iccProfiles = (rawText.match(/\/ICCBased/g) || []).length;

  // ── Annotations ───────────────────────────────────────────────────────────
  let totalAnnots = 0;
  const annotTypes = new Set();
  let reviewerNames = new Set();
  if (pjsDoc) {
    try {
      for (let i = 1; i <= pjsDoc.numPages; i++) {
        const page = await pjsDoc.getPage(i);
        const ann  = await page.getAnnotations();
        totalAnnots += ann.length;
        ann.forEach(a => {
          if (a.subtype) annotTypes.add(a.subtype);
          if (a.titleObj?.str) reviewerNames.add(a.titleObj.str);
          else if (a.title) reviewerNames.add(a.title);
        });
      }
    } catch {}
  }

  // ── Forms ─────────────────────────────────────────────────────────────────
  let formCount = "", hasAcroForm = "No";
  const hasXFA = rawText.slice(0, 65536).includes("/XFA") ? "Yes" : "No";
  if (pjsDoc) {
    try {
      const fields = await pjsDoc.getFieldObjects();
      if (fields) {
        const all = Object.values(fields).flat();
        hasAcroForm = all.length > 0 ? "Yes" : "No";
        formCount   = String(all.length);
      }
    } catch {}
  }
  const hasJSActions = rawText.includes("/JavaScript") || rawText.includes("/JS ") ? "Yes" : "No";

  // ── Navigation ────────────────────────────────────────────────────────────
  let bookmarks = "No", bookmarkCount = "0", linkCount = "0";
  let externalURLs = new Set();
  if (pjsDoc) {
    try {
      const outline = await pjsDoc.getOutline();
      if (outline && outline.length) { bookmarks = "Yes"; bookmarkCount = String(outline.length); }
      let lc = 0;
      for (let i = 1; i <= pjsDoc.numPages; i++) {
        const page = await pjsDoc.getPage(i);
        const ann  = await page.getAnnotations();
        ann.forEach(a => {
          if (a.subtype === "Link") {
            lc++;
            if (a.url) externalURLs.add(a.url);
          }
        });
      }
      linkCount = String(lc);
    } catch {}
  }

  // ── Embedded / attachments ────────────────────────────────────────────────
  const hasEmbedded   = rawText.includes("/EmbeddedFile") ? "Yes" : "No";
  const hasOpenAction = rawText.includes("/OpenAction")   ? "Yes" : "No";
  const hasLaunch     = rawText.includes("/Launch")       ? "Yes" : "No";
  const embFileCount  = (rawText.match(/\/EmbeddedFile/g) || []).length;

  // ── Compliance ────────────────────────────────────────────────────────────
  const isTagged   = rawText.includes("/MarkInfo")       ? "Yes" : "No";
  const isPdfA     = rawText.includes("pdfaid") || rawText.includes("PDF/A") ? "Yes" : "No";
  const isPdfX     = rawText.includes("GTS_PDFX") || rawText.includes("PDF/X") ? "Yes" : "No";
  const isPdfUA    = rawText.includes("pdfuaid")  ? "Yes" : "No";

  // ── Fraud indicators ──────────────────────────────────────────────────────
  const producerCount = (rawText.match(/\/Producer\s*\(/g) || []).length;
  const multiProducer = producerCount > 1 ? `Yes (${producerCount} entries)` : "No";
  const hasHiddenLayers = rawText.includes("/OCG")  ? "Yes (Optional Content Groups)" : "No";
  const hasRedact       = rawText.includes("/Redact")? "Yes" : "No";
  const hasDupObjIds    = detectDuplicateObjects(rawText);

  // ════════════════════════════════════════════════════════════════════════════
  return [
    {
      id: "general", title: "1. General File Information", icon: "file",
      fields: [
        { key:"fileName",     label:"File Name",              value: file.name },
        { key:"fileExt",      label:"File Extension",         value: "."+file.name.split(".").pop().toLowerCase() },
        { key:"fileSize",     label:"File Size",              value: fmtBytes(file.size) + ` (${file.size.toLocaleString()} bytes)` },
        { key:"mimeType",     label:"MIME Type",              value: file.type || "application/pdf" },
        { key:"md5",          label:"MD5 Hash",               value: md5hash },
        { key:"sha1",         label:"SHA-1 Hash",             value: sha1hash },
        { key:"sha256",       label:"SHA-256 Hash",           value: sha256hash },
        { key:"uploadTime",   label:"Upload Timestamp",       value: new Date().toISOString().replace("T"," ").slice(0,19) },
        { key:"lastModified", label:"File Last Modified",     value: new Date(file.lastModified).toISOString().replace("T"," ").slice(0,19) },
        { key:"fileOwner",    label:"File Owner",             value: "" },
        { key:"filePath",     label:"File Path / Origin",     value: "" },
        { key:"osMetadata",   label:"OS-Generated Metadata",  value: "" },
      ]
    },
    {
      id: "core", title: "2. Core PDF Metadata", icon: "info",
      fields: [
        { key:"title",        label:"Title",                  value: title,        pdfWritable: true },
        { key:"author",       label:"Author",                 value: author,       pdfWritable: true },
        { key:"subject",      label:"Subject",                value: subject,      pdfWritable: true },
        { key:"keywords",     label:"Keywords",               value: keywords,     pdfWritable: true, type:"textarea" },
        { key:"creator",      label:"Creator",                value: creator,      pdfWritable: true },
        { key:"producer",     label:"Producer",               value: producer,     pdfWritable: true },
        { key:"creationDate", label:"Creation Date",          value: creationDate, pdfWritable: true },
        { key:"modDate",      label:"Modification Date",      value: modDate,      pdfWritable: true },
        { key:"trapped",      label:"Trapped Status",         value: "" },
        { key:"pdfVersion",   label:"PDF Version",            value: pdfVersion },
        { key:"language",     label:"Language",               value: "" },
        { key:"docId",        label:"Document ID",            value: "" },
        { key:"instanceId",   label:"Instance ID",            value: "" },
        { key:"customMeta",   label:"Custom Metadata Fields", value: "",           type:"textarea" },
        { key:"xmpMeta",      label:"XMP Metadata Notes",     value: "",           type:"textarea" },
        { key:"dcMeta",       label:"Dublin Core Metadata",   value: "",           type:"textarea" },
      ]
    },
    {
      id: "structure", title: "3. PDF Structural Information", icon: "layers",
      fields: [
        { key:"pageCount",    label:"Number of Pages",        value: pageCount },
        { key:"pageOrder",    label:"Page Order",             value: "" },
        { key:"pageDims",     label:"Page Dimensions",        value: pageDims.join("\n"), type:"textarea" },
        { key:"orientation",  label:"Orientation",            value: pageDims.length ? (pageDims[0].includes("Landscape")?"Landscape":"Portrait") : "" },
        { key:"isLinearized", label:"Linearized PDF",         value: isLinearized },
        { key:"eofMarkers",   label:"EOF Markers Found",      value: String(eofCount) },
        { key:"pdfVersionS",  label:"PDF Version",            value: pdfVersion },
        { key:"objectCount",  label:"Object Count",           value: String((rawText.match(/\d+\s+\d+\s+obj/g)||[]).length) },
        { key:"hasThumbs",    label:"Thumbnail Images",       value: rawText.includes("/Thumb") ? "Yes" : "No" },
        { key:"hasHiddenPg",  label:"Hidden Pages",           value: rawText.includes("/Hidden") ? "Possible" : "No" },
        { key:"xrefType",     label:"Cross-Reference Tables", value: rawText.includes("/XRef") ? "Cross-Reference Stream" : "Traditional xref table" },
        { key:"structNotes",  label:"Structural Notes",       value: "",           type:"textarea" },
      ]
    },
    {
      id: "security", title: "4. Security Information", icon: "shield",
      fields: [
        { key:"isEncrypted",  label:"Is Encrypted",            value: isEncrypted },
        { key:"encAlgo",      label:"Encryption Algorithm",    value: encAlgo },
        { key:"secHandler",   label:"Security Handler",        value: secHandler },
        { key:"metaEncrypt",  label:"Metadata Encryption",     value: metaEncrypt },
        { key:"printPerm",    label:"Print Permissions",       value: printPerm },
        { key:"copyPerm",     label:"Copy Permissions",        value: copyPerm },
        { key:"editPerm",     label:"Edit Permissions",        value: editPerm },
        { key:"annotPerm",    label:"Annotation Permissions",  value: "" },
        { key:"formPerm",     label:"Form-Fill Permissions",   value: "" },
        { key:"accessPerm",   label:"Accessibility Permissions",value: "" },
        { key:"secNotes",     label:"Security Notes",          value: "",           type:"textarea" },
      ]
    },
    {
      id: "signatures", title: "5. Digital Signature Verification", icon: "pen",
      fields: [
        { key:"sigExists",    label:"Signature Exists",        value: sigExists },
        { key:"sigCount",     label:"Signature Count",         value: String(sigMatches.length) },
        { key:"sigValidity",  label:"Signature Validity",      value: sigExists==="Yes" ? "Present (browser-level check only)" : "N/A" },
        { key:"sigReason",    label:"Signature Reason",        value: sigReason },
        { key:"sigLocation",  label:"Signature Location",      value: sigLocation },
        { key:"sigContact",   label:"Signature Contact Info",  value: sigContact },
        { key:"signerName",   label:"Signer Name",             value: "" },
        { key:"sigTimestamp", label:"Signing Timestamp",       value: "" },
        { key:"certIssuer",   label:"Certificate Issuer",      value: "" },
        { key:"certSerial",   label:"Certificate Serial No.",  value: "" },
        { key:"certExpiry",   label:"Certificate Expiry Date", value: "" },
        { key:"revocation",   label:"Revocation Status",       value: "" },
        { key:"sigNotes",     label:"Signature Notes",         value: "",           type:"textarea" },
      ]
    },
    {
      id: "creator-sw", title: "6. Creator / Producer Software", icon: "cpu",
      fields: [
        { key:"creatorSW",    label:"Creator Software",        value: creator },
        { key:"producerSW",   label:"Producer Software",       value: producer },
        { key:"exportEngine", label:"Export Engine",           value: exportEngine },
        { key:"fingerprints", label:"Detected Fingerprints",   value: fingerprints.join(", "), type:"textarea" },
        { key:"adobeTrace",   label:"Adobe Traces",            value: /adobe/i.test(combined) ? "Yes" : "No" },
        { key:"photoshopTrace",label:"Photoshop Traces",       value: /photoshop/i.test(combined) ? "Yes" : "No" },
        { key:"canvaTrace",   label:"Canva Traces",            value: /canva/i.test(combined) ? "Yes" : "No" },
        { key:"wordTrace",    label:"Word Export Traces",      value: /microsoft\s+word/i.test(combined) ? "Yes" : "No" },
        { key:"ocrTrace",     label:"OCR Software Traces",     value: rawText.includes("/ActualText") ? "Possible" : "No" },
        { key:"scanTrace",    label:"Mobile Scanner Traces",   value: "" },
        { key:"webConvTrace", label:"Web Converter Traces",    value: /smallpdf|ilovepdf|pdf24|sejda/i.test(combined) ? "Yes" : "No" },
        { key:"swNotes",      label:"Software Notes",          value: "",           type:"textarea" },
      ]
    },
    {
      id: "fonts", title: "7. Font Analysis", icon: "type",
      fields: [
        { key:"fontCount",    label:"Unique Font Names",       value: String(fontNames.size) },
        { key:"fontNames",    label:"Font Names",              value: [...fontNames].join("\n"), type:"textarea" },
        { key:"fontTypes",    label:"Font Types Found",        value: [...fontTypeSet].join(", ") },
        { key:"embFontCount", label:"Embedded Font Count",     value: String(embeddedFontCount) },
        { key:"missingFonts", label:"Missing / Unembedded Fonts",value: "" },
        { key:"fontInconsist",label:"Font Inconsistencies",    value: "" },
        { key:"fontLicFlags", label:"Font Licensing Flags",    value: "" },
        { key:"fontNotes",    label:"Font Notes",              value: "",           type:"textarea" },
      ]
    },
    {
      id: "images", title: "10. Image Analysis", icon: "image",
      fields: [
        { key:"imgCount",     label:"Embedded Image Count",    value: String(imgCount) },
        { key:"hasJpeg",      label:"JPEG Streams (DCT)",      value: hasJpeg },
        { key:"hasJpeg2000",  label:"JPEG2000 Streams (JPX)",  value: hasJpeg2 },
        { key:"hasPng",       label:"PNG/Flate Streams",       value: hasFlate },
        { key:"iccProfiles",  label:"ICC Color Profiles",      value: String(iccProfiles) },
        { key:"imgDPI",       label:"Image DPI",               value: "" },
        { key:"imgDims",      label:"Image Dimensions",        value: "" },
        { key:"editedImgTrace",label:"Edited Image Traces",    value: "" },
        { key:"imgNotes",     label:"Image Notes",             value: "",           type:"textarea" },
      ]
    },
    {
      id: "annotations", title: "14. Annotation Analysis", icon: "message",
      fields: [
        { key:"hasAnnot",     label:"Has Annotations",         value: totalAnnots > 0 ? "Yes" : "No" },
        { key:"annotCount",   label:"Annotation Count",        value: String(totalAnnots) },
        { key:"annotTypes",   label:"Annotation Types",        value: [...annotTypes].join(", ") },
        { key:"reviewers",    label:"Reviewer Names",          value: [...reviewerNames].join(", ") },
        { key:"annotTimestamps",label:"Annotation Timestamps", value: "" },
        { key:"hiddenAnnot",  label:"Hidden Annotations",      value: "" },
        { key:"annotNotes",   label:"Annotation Notes",        value: "",           type:"textarea" },
      ]
    },
    {
      id: "forms", title: "15. Interactive Form Checks", icon: "clipboard",
      fields: [
        { key:"hasAcroForm",  label:"AcroForms Present",       value: hasAcroForm },
        { key:"hasXFA",       label:"XFA Forms Present",       value: hasXFA },
        { key:"formCount",    label:"Form Field Count",         value: formCount },
        { key:"hasJSActions", label:"JavaScript Actions",       value: hasJSActions },
        { key:"hiddenFields", label:"Hidden Form Fields",       value: "" },
        { key:"sigFields",    label:"Signature Fields",         value: String((rawText.match(/\/Sig\b/g)||[]).length) },
        { key:"autoSubmit",   label:"Auto-Submit Actions",      value: rawText.includes("/SubmitForm") ? "Yes" : "No" },
        { key:"formNotes",    label:"Form Notes",               value: "",           type:"textarea" },
      ]
    },
    {
      id: "navigation", title: "16. Navigation Structure", icon: "nav",
      fields: [
        { key:"hasBookmarks", label:"Bookmarks / Outline",     value: bookmarks },
        { key:"bookmarkCount",label:"Bookmark Count",          value: bookmarkCount },
        { key:"linkCount",    label:"Hyperlink Count",          value: linkCount },
        { key:"externalURLs", label:"External URLs",           value: [...externalURLs].join("\n"), type:"textarea" },
        { key:"namedDests",   label:"Named Destinations",      value: rawText.includes("/Dests") ? "Yes" : "No" },
        { key:"hiddenNav",    label:"Hidden Navigation Elements",value: "" },
        { key:"navNotes",     label:"Navigation Notes",        value: "",           type:"textarea" },
      ]
    },
    {
      id: "embedded", title: "13. Embedded Objects & Attachments", icon: "paperclip",
      fields: [
        { key:"hasEmbedded",  label:"Embedded Files",          value: hasEmbedded },
        { key:"embFileCount", label:"Embedded File Count",     value: String(embFileCount) },
        { key:"hasJS",        label:"JavaScript Present",      value: hasJSActions },
        { key:"hasOpenAction",label:"Open Actions",            value: hasOpenAction },
        { key:"hasLaunch",    label:"Launch Actions",          value: hasLaunch },
        { key:"hasMultimedia",label:"Multimedia Embedded",     value: rawText.includes("/RichMedia") ? "Yes" : "No" },
        { key:"hasZip",       label:"ZIP Attachments",         value: rawText.includes("PK\x03\x04") ? "Possible" : "No" },
        { key:"embNotes",     label:"Embedded Object Notes",   value: "",           type:"textarea" },
      ]
    },
    {
      id: "compliance", title: "19. Compliance & Accessibility", icon: "check", color:"green",
      fields: [
        { key:"isTagged",     label:"Tagged PDF",              value: isTagged },
        { key:"isPdfA",       label:"PDF/A Compliance",        value: isPdfA },
        { key:"isPdfX",       label:"PDF/X Compliance",        value: isPdfX },
        { key:"isPdfUA",      label:"PDF/UA Compliance",       value: isPdfUA },
        { key:"hasAltText",   label:"Alternate Text (Images)", value: rawText.includes("/Alt") ? "Present" : "Not detected" },
        { key:"readingOrder", label:"Reading Order",           value: "" },
        { key:"validationErrs",label:"Validation Errors",     value: "",           type:"textarea" },
        { key:"complianceNotes",label:"Compliance Notes",     value: "",           type:"textarea" },
      ]
    },
    {
      id: "fraud", title: "20. Fraud / Tampering Indicators", icon: "alert", color:"danger",
      fields: [
        { key:"multiProducer",  label:"Multiple Producer Entries",  value: multiProducer },
        { key:"incrementalMods",label:"Incremental Modifications",  value: eofCount > 1 ? `Yes (${eofCount} EOF markers)` : "No" },
        { key:"hiddenLayers",   label:"Hidden Layers (OCG)",        value: hasHiddenLayers },
        { key:"jsWarning",      label:"JavaScript (suspicious)",    value: hasJSActions === "Yes" ? "⚠ JavaScript found" : "None" },
        { key:"encryptWarning", label:"Encryption Status",          value: isEncrypted },
        { key:"hasRedaction",   label:"Redaction Traces",           value: hasRedact },
        { key:"dupObjIds",      label:"Duplicate Object IDs",       value: hasDupObjIds },
        { key:"metaInconsist",  label:"Metadata Inconsistencies",   value: "" },
        { key:"timestampAnom",  label:"Timestamp Anomalies",        value: "" },
        { key:"overlayText",    label:"Overlay Text",               value: "" },
        { key:"fakeLogo",       label:"Fake Logo / Seal Detected",  value: "" },
        { key:"structCorrupt",  label:"Structural Corruption",      value: "" },
        { key:"fraudNotes",     label:"Fraud Analysis Notes",       value: "",           type:"textarea" },
      ]
    },
  ];
}

// ── Render results ────────────────────────────────────────────────────────────
function renderResults(fileName, sections) {
  document.getElementById("result-filename").textContent = fileName;
  document.getElementById("result-subtitle").textContent =
    `${sections.length} categories · All fields are editable · Fields marked ✦ are written into the downloaded PDF`;

  const container = document.getElementById("sections-container");
  container.innerHTML = "";

  // Store originals for ALL fields
  sections.forEach(sec =>
    sec.fields.forEach(f => { originalFields[f.key] = f.value ?? ""; })
  );

  sections.forEach(sec => {
    const card = document.createElement("div");
    card.className = "section-card";
    card.dataset.id = sec.id;

    const hdr = document.createElement("div");
    hdr.className = "section-header";
    hdr.innerHTML = `
      <div class="section-title">
        <div class="section-icon ${sec.color === "danger" ? "danger" : sec.color === "green" ? "green" : ""}">
          ${svgIcon(sec.icon)}
        </div>
        <span class="section-name">${sec.title}</span>
      </div>
      <svg class="section-chevron" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/>
      </svg>`;
    hdr.addEventListener("click", () => card.classList.toggle("collapsed"));

    const body = document.createElement("div");
    body.className = "section-body";

    sec.fields.forEach(f => {
      const row = document.createElement("div");
      row.className = "field-row";
      row.dataset.key = f.key;

      // Label
      const labelEl = document.createElement("div");
      labelEl.className = "field-label";
      const pdfBadge = f.pdfWritable
        ? `<span class="pdf-writable-badge" title="This field is written into the downloaded PDF">✦</span>`
        : "";
      labelEl.innerHTML = `
        <span class="edited-dot" id="dot-${f.key}"></span>
        ${escHtml(f.label)}${pdfBadge}`;

      // Input
      const valEl = document.createElement("div");
      valEl.style.flex = "1";

      if (f.type === "textarea") {
        const ta = document.createElement("textarea");
        ta.className = "field-textarea";
        ta.value = f.value ?? "";
        ta.placeholder = `Enter ${f.label.toLowerCase()}…`;
        ta.addEventListener("input", () => onFieldEdit(f.key, ta.value));
        valEl.appendChild(ta);
      } else {
        const inp = document.createElement("input");
        inp.type = "text";
        inp.className = "field-input";
        inp.value = f.value ?? "";
        inp.placeholder = `Enter ${f.label.toLowerCase()}…`;
        inp.addEventListener("input", () => onFieldEdit(f.key, inp.value));
        valEl.appendChild(inp);
      }

      row.appendChild(labelEl);
      row.appendChild(valEl);
      body.appendChild(row);
    });

    card.appendChild(hdr);
    card.appendChild(body);
    container.appendChild(card);
  });
}

// ── Edit tracking ─────────────────────────────────────────────────────────────
function onFieldEdit(key, value) {
  const orig = originalFields[key] ?? "";
  if (value === orig) delete editedFields[key];
  else editedFields[key] = value;

  const dot = document.getElementById(`dot-${key}`);
  if (dot) dot.classList.toggle("visible", key in editedFields);
  updateEditCount();
}

function updateEditCount() {
  const n = Object.keys(editedFields).length;
  const label = `${n} change${n !== 1 ? "s" : ""}`;
  document.getElementById("edit-count").textContent  = label;
  document.getElementById("edit-count2").textContent = `${label} unsaved`;
  document.getElementById("edit-badge").classList.toggle("visible", n > 0);
  document.getElementById("edit-badge2").classList.toggle("visible", n > 0);
  const dlLabel = n > 0 ? `↓ Download with ${n} edit${n!==1?"s":""}` : "↓ Download PDF";
  document.getElementById("btn-download").textContent  = dlLabel;
  document.getElementById("btn-download2").textContent = dlLabel;
}

// ── Reset edits ───────────────────────────────────────────────────────────────
function resetEdits() {
  editedFields = {};
  Object.entries(originalFields).forEach(([key, orig]) => {
    const row = document.querySelector(`.field-row[data-key="${key}"]`);
    if (!row) return;
    const inp = row.querySelector("input, textarea");
    if (inp) inp.value = orig;
    const dot = document.getElementById(`dot-${key}`);
    if (dot) dot.classList.remove("visible");
  });
  updateEditCount();
  showToast("All changes have been reset.", "success");
}

// ── Download ──────────────────────────────────────────────────────────────────
async function downloadPdf() {
  if (!currentBytes) return;
  const btn = document.getElementById("btn-download");
  btn.disabled = true; btn.textContent = "Preparing…";
  try {
    const pdfDoc = await PDFLib.PDFDocument.load(currentBytes, { ignoreEncryption: true });

    const pick = (key) => key in editedFields ? editedFields[key] : null;

    const t = pick("title");   if (t !== null) pdfDoc.setTitle(t);
    const a = pick("author");  if (a !== null) pdfDoc.setAuthor(a);
    const s = pick("subject"); if (s !== null) pdfDoc.setSubject(s);
    const k = pick("keywords");if (k !== null) pdfDoc.setKeywords([k]);
    const c = pick("creator"); if (c !== null) pdfDoc.setCreator(c);
    const p = pick("producer");if (p !== null) pdfDoc.setProducer(p);
    const cd = pick("creationDate");
    if (cd) { try { const d=new Date(cd); if(!isNaN(d)) pdfDoc.setCreationDate(d); } catch {} }
    const md = pick("modDate");
    if (md) { try { const d=new Date(md); if(!isNaN(d)) pdfDoc.setModificationDate(d); } catch {} }

    const newBytes = await pdfDoc.save();
    const n = Object.keys(editedFields).length;
    const baseName = currentFileName.replace(/\.pdf$/i, "");
    triggerDownload(newBytes, n > 0 ? `${baseName}_edited.pdf` : currentFileName);
    showToast("PDF downloaded successfully!", "success");
  } catch (err) {
    showToast("Download failed: " + err.message, "error");
  } finally {
    btn.disabled = false;
    updateEditCount();
  }
}

function triggerDownload(bytes, name) {
  const blob = new Blob([bytes], { type:"application/pdf" });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement("a"), { href:url, download:name });
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
}

// ── Clear ─────────────────────────────────────────────────────────────────────
function clearAll() {
  currentBytes = null; currentFileName = ""; editedFields = {}; originalFields = {};
  show("upload-area"); hide("results-area"); hide("loading-area");
  document.getElementById("header-actions").style.display = "none";
  document.getElementById("sections-container").innerHTML = "";
  document.getElementById("file-input").value = "";
}

// ── Toast ─────────────────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg, type="default") {
  const el = document.getElementById("toast");
  document.getElementById("toast-msg").textContent = msg;
  el.className = "show " + (type==="success"?"success":type==="error"?"error":"");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className=""; }, 3500);
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function show(id) { document.getElementById(id).style.display = "flex"; }
function hide(id) { document.getElementById(id).style.display = "none"; }
function or(v)   { return v && String(v).trim() ? String(v).trim() : ""; }
function escHtml(s) { return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n/1024).toFixed(2)} KB`;
  return `${(n/1048576).toFixed(2)} MB`;
}
function fmtDate(d) {
  if (!d || !(d instanceof Date) || isNaN(d.getTime())) return "";
  return d.toISOString().replace("T"," ").slice(0,19);
}
function parsePdfDate(raw) {
  if (!raw) return "";
  const m = String(raw).match(/D:(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}` : String(raw);
}
function bytesToLatin1(u8) {
  let s="";
  for (let i=0; i<u8.length; i+=65536)
    s += String.fromCharCode(...u8.subarray(i, i+65536));
  return s;
}
function bufToHex(buf) {
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,"0")).join("");
}
function detectDuplicateObjects(rawText) {
  const ids = rawText.match(/^(\d+)\s+\d+\s+obj/gm) || [];
  const seen = new Set(), dups = new Set();
  ids.forEach(m => {
    const id = m.split(" ")[0];
    if (seen.has(id)) dups.add(id);
    seen.add(id);
  });
  return dups.size > 0 ? `Yes (${dups.size} duplicate IDs)` : "No";
}

// ── MD5 (pure JS) ─────────────────────────────────────────────────────────────
function computeMD5(input) {
  const s = [7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21];
  const K = Array.from({length:64},(_,i)=>(Math.abs(Math.sin(i+1))*0x100000000)>>>0);
  let a0=0x67452301,b0=0xefcdab89,c0=0x98badcfe,d0=0x10325476;
  const msgLen=input.length, padLen=msgLen%64<56?56-(msgLen%64):120-(msgLen%64);
  const padded=new Uint8Array(msgLen+padLen+8);
  padded.set(input); padded[msgLen]=0x80;
  const bitLen=msgLen*8;
  for(let i=0;i<8;i++) padded[msgLen+padLen+i]=(bitLen/Math.pow(2,8*i))&0xff;
  const view=new DataView(padded.buffer);
  for(let c=0;c<padded.length;c+=64){
    const M=Array.from({length:16},(_,j)=>view.getUint32(c+j*4,true));
    let A=a0,B=b0,C=c0,D=d0;
    for(let i=0;i<64;i++){
      let F,g;
      if(i<16){F=(B&C)|(~B&D);g=i;}
      else if(i<32){F=(D&B)|(~D&C);g=(5*i+1)%16;}
      else if(i<48){F=B^C^D;g=(3*i+5)%16;}
      else{F=C^(B|~D);g=(7*i)%16;}
      F=(F+A+K[i]+M[g])>>>0;A=D;D=C;C=B;
      B=(B+((F<<s[i])|(F>>>(32-s[i]))))>>>0;
    }
    a0=(a0+A)>>>0;b0=(b0+B)>>>0;c0=(c0+C)>>>0;d0=(d0+D)>>>0;
  }
  const r=new Uint8Array(16),rv=new DataView(r.buffer);
  rv.setUint32(0,a0,true);rv.setUint32(4,b0,true);
  rv.setUint32(8,c0,true);rv.setUint32(12,d0,true);
  return bufToHex(r.buffer);
}

// ── SVG Icons ─────────────────────────────────────────────────────────────────
function svgIcon(name) {
  const w = p => `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">${p}</svg>`;
  const icons = {
    file:      w(`<path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>`),
    info:      w(`<circle cx="12" cy="12" r="10"/><path stroke-linecap="round" stroke-linejoin="round" d="M12 16v-4m0-4h.01"/>`),
    layers:    w(`<path stroke-linecap="round" stroke-linejoin="round" d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>`),
    shield:    w(`<path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/>`),
    pen:       w(`<path stroke-linecap="round" stroke-linejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/>`),
    cpu:       w(`<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 9h6v6H9z"/><path d="M9 1v2M15 1v2M9 21v2M15 21v2M1 9h2M1 15h2M21 9h2M21 15h2"/>`),
    type:      w(`<path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h7"/>`),
    image:     w(`<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path stroke-linecap="round" stroke-linejoin="round" d="M21 15l-5-5L5 21"/>`),
    message:   w(`<path stroke-linecap="round" stroke-linejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/>`),
    clipboard: w(`<path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01m-.01 4h.01"/>`),
    nav:       w(`<path stroke-linecap="round" stroke-linejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"/>`),
    paperclip: w(`<path stroke-linecap="round" stroke-linejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"/>`),
    check:     w(`<path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>`),
    alert:     w(`<path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>`),
  };
  return icons[name] || icons.file;
}

// Expose globals for onclick attributes
window.handleFile  = handleFile;
window.resetEdits  = resetEdits;
window.downloadPdf = downloadPdf;
window.clearAll    = clearAll;
