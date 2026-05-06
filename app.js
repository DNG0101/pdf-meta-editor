"use strict";

// ── pdfjs setup ──────────────────────────────────────────────────────────────
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

// ── State ────────────────────────────────────────────────────────────────────
let currentBytes = null;
let currentFileName = "";
let originalFields = {};   // { key: originalValue }
let editedFields  = {};    // { key: editedValue } — only keys the user touched

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
  show("loading-area");
  hide("upload-area");
  hide("results-area");
  document.getElementById("header-actions").style.display = "none";
  currentBytes = null; currentFileName = file.name;
  editedFields = {}; originalFields = {};

  try {
    const buf = await file.arrayBuffer();
    currentBytes = new Uint8Array(buf);
    const sections = await buildSections(file, buf);
    renderResults(file.name, sections);
    show("results-area");
    hide("loading-area");
    document.getElementById("header-actions").style.display = "flex";
    showToast(`${sections.length} metadata categories extracted.`, "success");
  } catch (err) {
    hide("loading-area");
    show("upload-area");
    showToast("Failed to analyse PDF: " + err.message, "error");
    console.error(err);
  }
}

// ── Build all metadata sections ───────────────────────────────────────────────
async function buildSections(file, buf) {
  const bytes = new Uint8Array(buf);
  const rawText = bytesToLatin1(bytes);

  // 1. Hashes
  const [sha1Buf, sha256Buf] = await Promise.all([
    crypto.subtle.digest("SHA-1",   buf),
    crypto.subtle.digest("SHA-256", buf),
  ]);
  const md5hash   = computeMD5(bytes);
  const sha1hash  = bufToHex(sha1Buf);
  const sha256hash= bufToHex(sha256Buf);

  // 2. PDF version from header
  const headerMatch = rawText.slice(0, 20).match(/%PDF-(\d+\.\d+)/);
  const pdfVersion = headerMatch ? headerMatch[1] : null;

  // 3. pdf-lib
  let libDoc = null;
  try { libDoc = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true }); } catch {}

  // 4. pdfjs
  let pjsDoc = null;
  try {
    pjsDoc = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
  } catch {}

  // ─── Core metadata ───────────────────────────────────────────────────────
  let title = null, author = null, subject = null, keywords = null,
      creator = null, producer = null, creationDate = null, modDate = null;

  if (libDoc) {
    title = or(libDoc.getTitle());
    author = or(libDoc.getAuthor());
    subject = or(libDoc.getSubject());
    keywords = or(libDoc.getKeywords());
    creator = or(libDoc.getCreator());
    producer = or(libDoc.getProducer());
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

  // ─── Structure ───────────────────────────────────────────────────────────
  let pageCount = null;
  const pageDims = [];
  if (pjsDoc) {
    pageCount = String(pjsDoc.numPages);
    for (let i = 1; i <= Math.min(pjsDoc.numPages, 8); i++) {
      try {
        const page = await pjsDoc.getPage(i);
        const vp = page.getViewport({ scale: 1 });
        const orient = vp.width > vp.height ? "Landscape" : "Portrait";
        pageDims.push(`Page ${i}: ${vp.width.toFixed(0)}×${vp.height.toFixed(0)} pt  (${(vp.width/72).toFixed(2)}"×${(vp.height/72).toFixed(2)}")  —  ${orient}`);
      } catch {}
    }
    if (pjsDoc.numPages > 8) pageDims.push(`… and ${pjsDoc.numPages - 8} more pages`);
  } else if (libDoc) {
    pageCount = String(libDoc.getPageCount());
    libDoc.getPages().slice(0,8).forEach((p, i) => {
      const { width, height } = p.getSize();
      pageDims.push(`Page ${i+1}: ${width.toFixed(0)}×${height.toFixed(0)} pt — ${width > height ? "Landscape" : "Portrait"}`);
    });
  }
  const isLinearized = rawText.includes("/Linearized") ? "Yes" : "No";
  const eofCount = (rawText.match(/%%EOF/g) || []).length;

  // ─── Security ────────────────────────────────────────────────────────────
  let isEncrypted = rawText.includes("/Encrypt") ? "Yes" : "No";
  let encAlgo = null;
  if (isEncrypted === "Yes") {
    const vm = rawText.match(/\/V\s+(\d)/);
    if (vm) {
      const algMap = { 1:"RC4 40-bit", 2:"RC4 128-bit", 4:"AES 128-bit", 5:"AES 256-bit" };
      encAlgo = algMap[parseInt(vm[1])] || `Version ${vm[1]}`;
    }
  }
  let printPerm = null, copyPerm = null, editPerm = null;
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

  // ─── Signatures ──────────────────────────────────────────────────────────
  const sigMatches = rawText.match(/\/Type\s*\/Sig/g) || [];
  const sigExists  = sigMatches.length > 0 ? "Yes" : "No";

  // ─── Fonts ───────────────────────────────────────────────────────────────
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

  // ─── Images ──────────────────────────────────────────────────────────────
  const imgCount = (rawText.match(/\/Subtype\s*\/Image/g) || []).length;
  const hasJpeg  = rawText.includes("/DCTDecode")  ? "Yes" : "No";
  const hasFlate = rawText.includes("/FlateDecode") ? "Yes (FlateDecode)" : "No";

  // ─── Annotations ─────────────────────────────────────────────────────────
  let totalAnnots = 0;
  const annotTypes = new Set();
  if (pjsDoc) {
    try {
      for (let i = 1; i <= pjsDoc.numPages; i++) {
        const page = await pjsDoc.getPage(i);
        const ann  = await page.getAnnotations();
        totalAnnots += ann.length;
        ann.forEach(a => { if (a.subtype) annotTypes.add(a.subtype); });
      }
    } catch {}
  }

  // ─── Forms ───────────────────────────────────────────────────────────────
  let formCount = null, hasAcroForm = "No", hasXFA = rawText.slice(0,65536).includes("/XFA") ? "Yes" : "No";
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

  // ─── Navigation ──────────────────────────────────────────────────────────
  let bookmarks = "No", bookmarkCount = "0", linkCount = "0";
  if (pjsDoc) {
    try {
      const outline = await pjsDoc.getOutline();
      if (outline && outline.length) { bookmarks = "Yes"; bookmarkCount = String(outline.length); }
      let lc = 0;
      for (let i = 1; i <= pjsDoc.numPages; i++) {
        const page = await pjsDoc.getPage(i);
        const ann  = await page.getAnnotations();
        lc += ann.filter(a => a.subtype === "Link").length;
      }
      linkCount = String(lc);
    } catch {}
  }

  // ─── Embedded / JS ───────────────────────────────────────────────────────
  const hasEmbedded = rawText.includes("/EmbeddedFile") ? "Yes" : "No";
  const hasJS       = rawText.includes("/JavaScript") || rawText.includes("/JS ") ? "Yes" : "No";

  // ─── Compliance ──────────────────────────────────────────────────────────
  const isTagged = rawText.includes("/MarkInfo") ? "Yes" : "No";
  const isPdfA   = rawText.includes("pdfaid") || rawText.includes("PDF/A") ? "Yes (traces found)" : "No traces";

  // ─── Fraud indicators ────────────────────────────────────────────────────
  const producerCount = (rawText.match(/\/Producer\s*\(/g) || []).length;
  const multiProducer = producerCount > 1 ? `Yes (${producerCount} producer entries found)` : "No";
  const hasHiddenLayers = rawText.includes("/OCG") ? "Yes (Optional Content Groups found)" : "No";

  // ─── Creator/Producer fingerprints ───────────────────────────────────────
  const fingerprints = [];
  const fingerprintMap = [
    [/adobe\s+acrobat/i,  "Adobe Acrobat"],
    [/adobe\s+distiller/i,"Adobe Distiller"],
    [/photoshop/i,        "Adobe Photoshop"],
    [/canva/i,            "Canva"],
    [/microsoft\s+word/i, "Microsoft Word"],
    [/libreoffice/i,      "LibreOffice"],
    [/wps\s+office/i,     "WPS Office"],
    [/google\s+docs/i,    "Google Docs"],
    [/ilovepdf/i,         "iLovePDF"],
    [/smallpdf/i,         "SmallPDF"],
    [/pdf24/i,            "PDF24"],
    [/pdfcreator/i,       "PDFCreator"],
    [/nitro/i,            "Nitro PDF"],
    [/foxit/i,            "Foxit"],
    [/quartz\s+pdfcontext/i,"macOS Quartz (Print to PDF)"],
    [/skia/i,             "Skia (Chrome/Chromium)"],
    [/fpdf/i,             "FPDF library"],
    [/reportlab/i,        "ReportLab (Python)"],
    [/itext/i,            "iText library"],
    [/tcpdf/i,            "TCPDF library"],
  ];
  const combined = [title, author, creator, producer, rawText.slice(0, 4096)].join(" ");
  fingerprintMap.forEach(([re, label]) => { if (re.test(combined)) fingerprints.push(label); });

  // ════════════════════════════════════════════════════════════════
  // Assemble sections
  // ════════════════════════════════════════════════════════════════
  return [
    {
      id: "general", title: "1. General File Information", icon: "file", color: "blue",
      fields: [
        { key:"fileName",    label:"File Name",         value: file.name },
        { key:"fileExt",     label:"File Extension",    value: "."+file.name.split(".").pop().toLowerCase() },
        { key:"fileSize",    label:"File Size",         value: fmtBytes(file.size) + ` (${file.size.toLocaleString()} bytes)` },
        { key:"mimeType",    label:"MIME Type",         value: file.type || "application/pdf" },
        { key:"md5",         label:"MD5 Hash",          value: md5hash },
        { key:"sha1",        label:"SHA-1 Hash",        value: sha1hash },
        { key:"sha256",      label:"SHA-256 Hash",      value: sha256hash },
        { key:"uploadTime",  label:"Upload Timestamp",  value: new Date().toISOString().replace("T"," ").slice(0,19) },
        { key:"lastModified",label:"File Last Modified",value: new Date(file.lastModified).toISOString().replace("T"," ").slice(0,19) },
      ]
    },
    {
      id: "core", title: "2. Core PDF Metadata", icon: "info", color: "blue",
      fields: [
        { key:"title",        label:"Title",             value: title,        editable: true, type:"text"     },
        { key:"author",       label:"Author",            value: author,       editable: true, type:"text"     },
        { key:"subject",      label:"Subject",           value: subject,      editable: true, type:"text"     },
        { key:"keywords",     label:"Keywords",          value: keywords,     editable: true, type:"textarea" },
        { key:"creator",      label:"Creator",           value: creator,      editable: true, type:"text"     },
        { key:"producer",     label:"Producer",          value: producer,     editable: true, type:"text"     },
        { key:"creationDate", label:"Creation Date",     value: creationDate, editable: true, type:"text"     },
        { key:"modDate",      label:"Modification Date", value: modDate,      editable: true, type:"text"     },
        { key:"pdfVersion",   label:"PDF Version",       value: pdfVersion },
      ]
    },
    {
      id: "structure", title: "3. PDF Structural Information", icon: "layers", color: "blue",
      fields: [
        { key:"pageCount",    label:"Number of Pages",    value: pageCount },
        { key:"pageDims",     label:"Page Dimensions",    value: pageDims.join("\n") || null },
        { key:"isLinearized", label:"Linearized PDF",     value: isLinearized },
        { key:"eofMarkers",   label:"EOF Markers",        value: String(eofCount) },
        { key:"pdfVersionS",  label:"PDF Version",        value: pdfVersion },
      ]
    },
    {
      id: "security", title: "4. Security Information", icon: "shield", color: "blue",
      fields: [
        { key:"isEncrypted", label:"Is Encrypted",         value: isEncrypted },
        { key:"encAlgo",     label:"Encryption Algorithm", value: encAlgo },
        { key:"printPerm",   label:"Print Permissions",    value: printPerm },
        { key:"copyPerm",    label:"Copy Permissions",     value: copyPerm },
        { key:"editPerm",    label:"Edit Permissions",     value: editPerm },
      ]
    },
    {
      id: "signatures", title: "5. Digital Signature Verification", icon: "pen", color: "blue",
      fields: [
        { key:"sigExists", label:"Signature Exists",  value: sigExists },
        { key:"sigCount",  label:"Signature Count",   value: String(sigMatches.length) },
        { key:"sigValidity",label:"Signature Validity",value: sigExists === "Yes" ? "Present (browser-level validation limited)" : "N/A" },
      ]
    },
    {
      id: "creator-sw", title: "6. Creator / Producer Software", icon: "cpu", color: "blue",
      fields: [
        { key:"creatorSW",     label:"Creator Software",  value: creator },
        { key:"producerSW",    label:"Producer Software", value: producer },
        { key:"fingerprints",  label:"Detected Fingerprints", value: fingerprints.length ? fingerprints.join(", ") : "None detected" },
      ]
    },
    {
      id: "fonts", title: "7. Font Analysis", icon: "type", color: "blue",
      fields: [
        { key:"fontCount", label:"Unique Font Names",   value: fontNames.size > 0 ? String(fontNames.size) : "0" },
        { key:"fontNames", label:"Font Names",          value: fontNames.size > 0 ? [...fontNames].join("\n") : null },
        { key:"fontTypes", label:"Font Types Found",    value: fontTypeSet.size > 0 ? [...fontTypeSet].join(", ") : null },
      ]
    },
    {
      id: "images", title: "10. Image Analysis", icon: "image", color: "blue",
      fields: [
        { key:"imgCount",  label:"Embedded Image Count", value: String(imgCount) },
        { key:"hasJpeg",   label:"JPEG Streams",         value: hasJpeg },
        { key:"hasPng",    label:"PNG/Flate Streams",    value: hasFlate },
      ]
    },
    {
      id: "annotations", title: "14. Annotation Analysis", icon: "message", color: "blue",
      fields: [
        { key:"hasAnnot",    label:"Has Annotations",   value: totalAnnots > 0 ? "Yes" : "No" },
        { key:"annotCount",  label:"Annotation Count",  value: String(totalAnnots) },
        { key:"annotTypes",  label:"Annotation Types",  value: annotTypes.size > 0 ? [...annotTypes].join(", ") : null },
      ]
    },
    {
      id: "forms", title: "15. Interactive Form Checks", icon: "clipboard", color: "blue",
      fields: [
        { key:"hasAcroForm", label:"AcroForms Present",  value: hasAcroForm },
        { key:"hasXFA",      label:"XFA Forms Present",  value: hasXFA },
        { key:"formCount",   label:"Form Field Count",   value: formCount },
      ]
    },
    {
      id: "navigation", title: "16. Navigation Structure", icon: "nav", color: "blue",
      fields: [
        { key:"hasBookmarks",   label:"Bookmarks / Outline", value: bookmarks },
        { key:"bookmarkCount",  label:"Bookmark Count",      value: bookmarkCount },
        { key:"linkCount",      label:"Hyperlink Count",      value: linkCount },
      ]
    },
    {
      id: "embedded", title: "13. Embedded Objects & Attachments", icon: "paperclip", color: "blue",
      fields: [
        { key:"hasEmbedded", label:"Embedded Files",        value: hasEmbedded },
        { key:"hasJS",       label:"JavaScript Present",    value: hasJS },
      ]
    },
    {
      id: "compliance", title: "19. Compliance & Accessibility", icon: "check", color: "green",
      fields: [
        { key:"isTagged", label:"Tagged PDF (Accessibility)", value: isTagged },
        { key:"isPdfA",   label:"PDF/A Compliance Traces",   value: isPdfA },
      ]
    },
    {
      id: "fraud", title: "20. Fraud / Tampering Indicators", icon: "alert", color: "danger",
      fields: [
        { key:"multiProducer",    label:"Multiple Producer Entries",     value: multiProducer },
        { key:"incrementalMods",  label:"Incremental Modifications",     value: eofCount > 1 ? `Yes (${eofCount} EOF markers)` : "No" },
        { key:"hiddenLayers",     label:"Hidden Layers (OCG)",           value: hasHiddenLayers },
        { key:"jsWarning",        label:"JavaScript (suspicious)",        value: hasJS === "Yes" ? "⚠ JavaScript found — review recommended" : "None found" },
        { key:"encryptWarning",   label:"Encryption Status",             value: isEncrypted === "Yes" ? "⚠ Document is encrypted" : "Not encrypted" },
      ]
    },
  ];
}

// ── Render results ────────────────────────────────────────────────────────────
function renderResults(fileName, sections) {
  document.getElementById("result-filename").textContent = fileName;
  document.getElementById("result-subtitle").textContent =
    `${sections.length} categories extracted — edit the highlighted fields and download`;

  const container = document.getElementById("sections-container");
  container.innerHTML = "";

  // Store originals
  sections.forEach(sec => {
    sec.fields.forEach(f => { if (f.editable) originalFields[f.key] = f.value || ""; });
  });

  sections.forEach(sec => {
    const card = document.createElement("div");
    card.className = "section-card";
    card.dataset.id = sec.id;

    // Header
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

    // Body
    const body = document.createElement("div");
    body.className = "section-body";

    sec.fields.forEach(f => {
      const row = document.createElement("div");
      row.className = "field-row";
      row.dataset.key = f.key;

      const labelEl = document.createElement("div");
      labelEl.className = "field-label";
      labelEl.innerHTML = `<span class="edited-dot" id="dot-${f.key}"></span>${escHtml(f.label)}`;

      const valEl = document.createElement("div");

      if (f.editable) {
        if (f.type === "textarea") {
          const ta = document.createElement("textarea");
          ta.className = "field-textarea";
          ta.value = f.value || "";
          ta.placeholder = `Enter ${f.label.toLowerCase()}…`;
          ta.addEventListener("input", () => onFieldEdit(f.key, ta.value));
          valEl.appendChild(ta);
        } else {
          const inp = document.createElement("input");
          inp.type = "text";
          inp.className = "field-input";
          inp.value = f.value || "";
          inp.placeholder = `Enter ${f.label.toLowerCase()}…`;
          inp.addEventListener("input", () => onFieldEdit(f.key, inp.value));
          valEl.appendChild(inp);
        }
      } else {
        const span = document.createElement("div");
        if (f.value) {
          span.className = "field-value";
          span.textContent = f.value;
        } else {
          span.className = "field-value empty";
          span.textContent = "Not available";
        }
        valEl.appendChild(span);
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
  const orig = originalFields[key] || "";
  if (value === orig) {
    delete editedFields[key];
  } else {
    editedFields[key] = value;
  }
  const dot = document.getElementById(`dot-${key}`);
  if (dot) dot.classList.toggle("visible", key in editedFields);
  updateEditCount();
}

function updateEditCount() {
  const n = Object.keys(editedFields).length;
  const badge1 = document.getElementById("edit-badge");
  const badge2 = document.getElementById("edit-badge2");
  const count1 = document.getElementById("edit-count");
  const count2 = document.getElementById("edit-count2");
  const label = `${n} change${n !== 1 ? "s" : ""}`;
  if (count1) count1.textContent = label;
  if (count2) count2.textContent = `${label} unsaved`;
  badge1.classList.toggle("visible", n > 0);
  badge2.classList.toggle("visible", n > 0);
  document.getElementById("btn-download").textContent = n > 0
    ? `↓ Download with ${n} edit${n !== 1 ? "s" : ""}`
    : "↓ Download PDF";
  document.getElementById("btn-download2").textContent = document.getElementById("btn-download").textContent;
}

// ── Reset edits ───────────────────────────────────────────────────────────────
function resetEdits() {
  editedFields = {};
  // restore all inputs
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
  btn.disabled = true;
  btn.textContent = "Preparing…";
  try {
    const pdfDoc = await PDFLib.PDFDocument.load(currentBytes, { ignoreEncryption: true });
    const apply = (key, fn) => {
      const val = key in editedFields ? editedFields[key] : null;
      if (val !== null) fn(val);
    };
    apply("title",        v => pdfDoc.setTitle(v));
    apply("author",       v => pdfDoc.setAuthor(v));
    apply("subject",      v => pdfDoc.setSubject(v));
    apply("keywords",     v => pdfDoc.setKeywords([v]));
    apply("creator",      v => pdfDoc.setCreator(v));
    apply("producer",     v => pdfDoc.setProducer(v));
    apply("creationDate", v => { try { const d = new Date(v); if (!isNaN(d)) pdfDoc.setCreationDate(d); } catch {} });
    apply("modDate",      v => { try { const d = new Date(v); if (!isNaN(d)) pdfDoc.setModificationDate(d); } catch {} });

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
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
}

// ── Clear / reset page ────────────────────────────────────────────────────────
function clearAll() {
  currentBytes = null; currentFileName = ""; editedFields = {}; originalFields = {};
  show("upload-area"); hide("results-area"); hide("loading-area");
  document.getElementById("header-actions").style.display = "none";
  document.getElementById("sections-container").innerHTML = "";
  document.getElementById("file-input").value = "";
}

// ── Toast ──────────────────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg, type = "default") {
  const el  = document.getElementById("toast");
  const ico = document.getElementById("toast-icon");
  const msgEl = document.getElementById("toast-msg");
  msgEl.textContent = msg;
  el.className = "show " + (type === "success" ? "success" : type === "error" ? "error" : "");
  ico.innerHTML = type === "error"
    ? `<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>`
    : `<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/>`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ""; }, 3500);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function show(id) { document.getElementById(id).style.display = "flex"; }
function hide(id) { document.getElementById(id).style.display = "none"; }
function or(v)   { return (v && String(v).trim()) ? String(v).trim() : null; }
function escHtml(s) { return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n/1024).toFixed(2)} KB`;
  return `${(n/1048576).toFixed(2)} MB`;
}
function fmtDate(d) {
  if (!d || !(d instanceof Date) || isNaN(d.getTime())) return null;
  return d.toISOString().replace("T"," ").slice(0,19);
}
function parsePdfDate(raw) {
  if (!raw) return null;
  const m = String(raw).match(/D:(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`;
  return raw;
}
function bytesToLatin1(u8) {
  let s = "";
  const chunk = 65536;
  for (let i = 0; i < u8.length; i += chunk)
    s += String.fromCharCode(...u8.subarray(i, i + chunk));
  return s;
}
function bufToHex(buf) {
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,"0")).join("");
}

// ── MD5 (pure JS) ─────────────────────────────────────────────────────────────
function computeMD5(input) {
  const s = [7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21];
  const K = Array.from({length:64}, (_,i) => (Math.abs(Math.sin(i+1)) * 0x100000000) >>> 0);
  let a0=0x67452301, b0=0xefcdab89, c0=0x98badcfe, d0=0x10325476;
  const msgLen = input.length;
  const padLen = msgLen % 64 < 56 ? 56-(msgLen%64) : 120-(msgLen%64);
  const padded = new Uint8Array(msgLen + padLen + 8);
  padded.set(input); padded[msgLen] = 0x80;
  const bitLen = msgLen * 8;
  for (let i = 0; i < 8; i++) padded[msgLen+padLen+i] = (bitLen / Math.pow(2,8*i)) & 0xff;
  const view = new DataView(padded.buffer);
  for (let c = 0; c < padded.length; c += 64) {
    const M = Array.from({length:16}, (_,j) => view.getUint32(c+j*4,true));
    let A=a0, B=b0, C=c0, D=d0;
    for (let i=0;i<64;i++) {
      let F, g;
      if      (i<16) { F=(B&C)|(~B&D); g=i; }
      else if (i<32) { F=(D&B)|(~D&C); g=(5*i+1)%16; }
      else if (i<48) { F=B^C^D;        g=(3*i+5)%16; }
      else           { F=C^(B|~D);     g=(7*i)%16; }
      F=(F+A+K[i]+M[g])>>>0; A=D; D=C; C=B;
      B=(B+((F<<s[i])|(F>>>(32-s[i]))))>>>0;
    }
    a0=(a0+A)>>>0; b0=(b0+B)>>>0; c0=(c0+C)>>>0; d0=(d0+D)>>>0;
  }
  const r = new Uint8Array(16), rv = new DataView(r.buffer);
  rv.setUint32(0,a0,true); rv.setUint32(4,b0,true);
  rv.setUint32(8,c0,true); rv.setUint32(12,d0,true);
  return bufToHex(r.buffer);
}

// ── Icon SVG snippets ─────────────────────────────────────────────────────────
function svgIcon(name) {
  const wrap = (path) =>
    `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">${path}</svg>`;
  const icons = {
    file:      wrap(`<path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>`),
    info:      wrap(`<circle cx="12" cy="12" r="10"/><path stroke-linecap="round" stroke-linejoin="round" d="M12 16v-4m0-4h.01"/>`),
    layers:    wrap(`<path stroke-linecap="round" stroke-linejoin="round" d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>`),
    shield:    wrap(`<path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/>`),
    pen:       wrap(`<path stroke-linecap="round" stroke-linejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/>`),
    cpu:       wrap(`<rect x="4" y="4" width="16" height="16" rx="2"/><path stroke-linecap="round" stroke-linejoin="round" d="M9 9h6v6H9z"/><path d="M9 1v2M15 1v2M9 21v2M15 21v2M1 9h2M1 15h2M21 9h2M21 15h2"/>`),
    type:      wrap(`<path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h7"/>`),
    image:     wrap(`<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path stroke-linecap="round" stroke-linejoin="round" d="M21 15l-5-5L5 21"/>`),
    message:   wrap(`<path stroke-linecap="round" stroke-linejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/>`),
    clipboard: wrap(`<path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01m-.01 4h.01"/>`),
    nav:       wrap(`<path stroke-linecap="round" stroke-linejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"/>`),
    paperclip: wrap(`<path stroke-linecap="round" stroke-linejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"/>`),
    check:     wrap(`<path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>`),
    alert:     wrap(`<path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>`),
  };
  return icons[name] || icons.file;
}

// Expose globals needed by onclick attributes
window.handleFile  = handleFile;
window.resetEdits  = resetEdits;
window.downloadPdf = downloadPdf;
window.clearAll    = clearAll;
