# Universal File Metadata Inspector & Cleaner

Local-first, GitHub Pages compatible file metadata analysis and conservative removal. Selected files are processed locally in the browser and not uploaded to an app backend. JavaScript dependencies currently load from external CDNs.

## Modes

- **All files:** inspect local files, detect format signatures, remove known metadata where supported, verify output by reinspection, batch-clean files, and export JSON reports.
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

Verification includes JPEG/PNG/WebP/MP3/WAV/GIF/FLAC byte-structure fixtures, PDF and Office reinspection, malicious ZIP resource bounds and browser UI smoke checks. Test success is not universal compatibility certification.

Each new file format must be implemented with a real parser, a format-specific cleaner, and a post-clean validation step. Never blindly replace byte sequences in arbitrary files.
