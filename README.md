# Universal File Metadata Inspector & Cleaner

Local-first, GitHub Pages compatible file metadata analysis and conservative removal. Selected files are processed locally in the browser and not uploaded to an app backend. JavaScript dependencies currently load from external CDNs.

## Modes

- **All files:** inspect local files, detect format signatures, **show parsed field names, actual values and sources** where supported, remove known metadata where supported, verify output by reinspection, batch-clean files, and export JSON reports.
- **Advanced PDF:** detailed inspection and editing of the eight supported writable Info fields (Title, Author, Subject, Keywords, Creator, Producer, CreationDate and ModDate). Other values are read-only.

## Format-specific cleanup

| Format | Removes | Boundaries |
| --- | --- | --- |
| JPEG | EXIF/XMP APP1, IPTC APP13, COM | Other APP segments and ICC color profiles are preserved |
| PNG | tEXt, zTXt, iTXt, eXIf, tIME | PNG CRC checks; pixels, unknown chunks and color profile preserved |
| WebP | EXIF, XMP; fixes VP8X flags | Media and ICC preserved; refuses metadata without VP8X |
| MP3 | ID3v2 header and trailing ID3v1 | Other tag formats/identifiers possible; APEv2 refused |
| WAV | LIST/INFO, BEXT, iXML, AXML, CART, DISP, ID3, XMP | Other RIFF chunks and audio preserved |
| PDF | Info dictionary and catalog XMP | **Partial removal only**; signed PDFs refused; nested metadata can remain |
| DOCX/XLSX/PPTX | Standard docProps and package relationships | Embedded objects/content are NOT sanitized; signed Office ZIP packages refused |
| GIF | Comment and XMP application extension | Animation, looping, palettes, graphic controls and unknown application blocks preserved |
| FLAC | Vorbis comments and embedded picture blocks | STREAMINFO, audio frames and other metadata blocks preserved |
| TIFF, BMP, OGG, MP4/MOV, HEIC/AVIF, SVG, 7z, RAR, gzip, EXE/ELF | None | Signature-based inspection only, no content modification |
| Unknown formats and generic ZIP | None | Inspection-only, never falsely claim to be cleaned |

Formats are detected using file magic and relevant package structure, not filenames alone.

## Field-level inspection and verification

The universal interface now lists parsed field names, values and source containers per file, not just metadata-block counts. Its inspection coverage is **explicitly partial** and may not include every identifier in a file. Examples of fields available:

- JPEG EXIF/TIFF: maker, camera model, orientation, timestamp, artist, GPS tag values and selected other TIFF tags; XMP preview and ICC/IPTC presence.
- PNG: image dimensions and depth, tEXt, uncompressed iTXt, modification time, supported eXIf fields and ICC presence. Compressed zTXt/iTXt is reported as present but not decoded.
- WebP: selected EXIF fields, XMP preview and ICC presence.
- MP3: common ID3v2.3/v2.4 text frames, attached-image presence and ID3v1 values. Other ID3 features may not be decoded.
- WAV: LIST/INFO values, channels, sample rate and recognized metadata-chunk presence.
- FLAC: Vorbis comment values, encoder and picture/application-block presence.
- GIF: comment text and recognized XMP application-block presence.
- PDF: page count, Info dictionary getters and catalog XMP presence; nested XMP, revisions and embedded identifiers remain out of scope.
- DOCX/XLSX/PPTX: recognized `docProps` XML leaf field values using guarded ZIP decompression. Comments/revisions/embedded objects remain out of scope.
- Other formats: identification only unless an explicit parser supports more fields; **no indication of an empty metadata field list implies no metadata exists**.

After cleaning, the app checks that known removable blocks are absent, reports remaining parsed fields, and cross-checks selected structural fields. This is not a full decode/render comparison or a general content-integrity certificate. EXIF orientation values other than 1 are conservatively **refused for metadata stripping** rather than quietly changing how the image displays.

The browser workbench currently requires some CDN dependencies, must handle file limits, and does not claim universal format compatibility. All parsing takes place on the selected local bytes.

## Important: SynthID and invisible watermarks

**SynthID is not ordinary EXIF or document metadata.** It may be encoded within pixels, audio, or other content. The tool cannot guarantee its detection or removal. A status of *Verified* means only that known format-specific removable blocks are absent upon reinspection. It is not certification that every piece of metadata, trace, or watermark is gone.

## Safeguards and limitations

- Original files are never overwritten.
- Invalid inputs fail without reporting a false clean result.
- Office ZIP files undergo central-directory preflight before decompression (entry, path, ratio and expanded-size limits). This reduces, but does not eliminate, archive bomb risk.
- Cleaning controls include cancellation between files, a 384 MiB aggregate batch budget and unique output names.
- Digital signatures can be invalidated by rewrites; suspected signed PDFs and signed Office packages are rejected.
- Batch output is ZIP packaged if more than one file changes.
- Local browser safety limit: 256 MiB per file; peak memory use can be higher.
- SHA-256 calculation is skipped for files over 32 MiB to reduce pressure.
- PDF rewrites can remove incremental history. No cryptographic signature validation or forensic certification is provided.
- No backend is required. CDN library requests occur for initial dependency loading.

## Local development and tests

Serve this directory over HTTP (for example: python3 -m http.server 8080), then open http://localhost:8080.

Node.js 22+ commands: npm install; npm run verify.

Verification includes JPEG/PNG/WebP/MP3/WAV/GIF/FLAC byte-structure fixtures, PDF and Office reinspection, malicious ZIP resource bounds, field extraction/cleaning round trips, display-orientation refusal and a browser DOM test asserting that metadata values display safely. Test success is not universal compatibility certification.

Each new file format must be implemented with a real parser, a format-specific cleaner, and a post-clean validation step. Never blindly replace byte sequences in arbitrary files.
