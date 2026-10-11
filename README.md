# Universal File Metadata Inspector & Cleaner

Local-first, GitHub Pages compatible file metadata analysis and conservative removal. Selected files are processed locally in the browser and not uploaded to an app backend. JavaScript dependencies currently load from external CDNs.

## Modes

- **All files:** automatically inspect files on selection, detect format signatures, **show parsed field names, actual values and sources** where supported, remove known metadata where supported, verify output by reinspection, batch-clean files, and export JSON reports.
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

## Automatic inspection and GIF field visibility

Selecting or dropping files in **All files** mode now starts inspection automatically. **Queued for inspection** means the file has not been processed yet; only **Inspected**, **Unsupported / inspect only**, or **Error** is a finished inspection status. You can still manually select **Inspect files** to repeat the operation.

For animated GIFs, the inspector additionally reports the logical canvas width/height, GIF version, frame count, declared frame durations, transparency-frame count, looping instructions, several frame geometries, recognized comment and XMP application metadata, and unknown application-extension IDs. The table separates **Technical** file properties from **Metadata** fields. GIF technical details do not imply personally identifying metadata is present, and an absence of recognized metadata fields does **not** establish that all metadata or embedded watermarks are absent.

The GIF cleaner removes only supported comment and XMP application extensions. It preserves animation, palette, frames, looping and unrecognized application extensions. A GIF without removable blocks is not exported as a falsely "cleaned" file.

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

## Version 0.5: verified sanitization

The removal button now requires **two separate results** before releasing a cleaned file:

1. A reinspection of the cleaned file confirms no additional blocks recognized by the cleaner remain.
2. The independent content verifier confirms that preserved binary content matches the original for JPEG, PNG, WebP, GIF, MP3, WAV and FLAC. For Office files, it compares retained ZIP entries after decompression. PDF validation currently checks page count, geometry and rotation only: **PDF rendering and text are not fully verified**.

The interface exposes a before/after comparison for the parsed metadata fields. This comparison is **not exhaustive**, because the field inspector covers a documented subset of metadata structures. A successful result is therefore only a *scoped verification*, not a metadata-free or watermark-free certificate.

Specific corrections in this version:

- Multi-scan JPEGs are inspected across all scan boundaries, including metadata following the first scan; entropy-coded image payloads are kept byte-for-byte.
- PNG zTXt and compressed iTXt text values are decompressed and displayed when the browser supports DecompressionStream, under a 256 KiB decompressed-value budget. Unsupported, malformed and oversize compressed fields are disclosed, never silently marked as decoded.
- ZIP validation compares local and central entry headers, rejects contradictory compression/method/CRC/file names and detects overlapping entries before attempting Office decompression.
- Unsupported formats remain inspection-only; the cleaner never claims universal operation.
- SynthID or other content-embedded identifiers are **not tested or removed by this tool**. Use a trusted, format-appropriate detector for any claim about their presence; ordinary metadata stripping cannot prove absence.

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

Verification includes byte-by-byte preservation and tampering cases across JPEG/PNG/WebP/MP3/WAV/GIF/FLAC, PDF structural cases, Office archive entry comparisons and JPEG multiscan/PNG compressed-text cases, as well as JPEG/PNG/WebP/MP3/WAV/GIF/FLAC byte-structure fixtures, PDF and Office reinspection, malicious ZIP resource bounds, field extraction/cleaning round trips, display-orientation refusal and a browser DOM test asserting that metadata values display safely. Test success is not universal compatibility certification.

Each new file format must be implemented with a real parser, a format-specific cleaner, and a post-clean validation step. Never blindly replace byte sequences in arbitrary files.
