# PDF Review Extension

[English](#english) | [Español](#español)

## English

Pi extension for reading local PDF files as agent context.

### Tools

#### `pdf_extract`

Extracts text, file metadata, a SHA-256 hash, warnings, and optional rendered page metadata from a local PDF.

Parameters:

- `path` — local PDF path, relative to the current workspace or absolute.
- `textCharsLimit` — maximum extracted text characters returned; defaults to `50000`.
- `renderPages` — when `true`, uses the proven `pdf-parse` screenshot flow to render bounded page metadata. Base64 image payloads are not returned to avoid flooding tool context.
- `pagesLimit` — maximum rendered pages when `renderPages` is enabled; defaults to `5`.
- `renderWidth` — desired render width; defaults to `1280`.
- `ocrMode` — `none` or `auto`. In `auto`, OCR runs only when the PDF text layer is empty.
- `ocrProvider` — currently `ocrmypdf`.
- `ocrLanguage` — OCR language for OCRmyPDF/Tesseract, such as `eng`, `spa`, or `spa+eng`; defaults to `eng`.

The implementation follows the verified SIAS approach: read PDF bytes, compute SHA-256, create `PDFParse`, call `getText()`, optionally call `getScreenshot()`, and always destroy the parser. If `ocrMode: "auto"` is enabled and `getText()` returns no text, the tool shells out to OCRmyPDF with `--sidecar` to obtain OCR text.

### OCR dependency

OCR is optional. To use `ocrMode: "auto"` with `ocrProvider: "ocrmypdf"`, install OCRmyPDF and its system dependencies (`tesseract`, Ghostscript, language packs such as Spanish if needed). If OCRmyPDF is unavailable or fails, `pdf_extract` returns empty text plus an `OCR_UNAVAILABLE` warning instead of failing the whole extraction.

### Validation

Run from `extensions/pdf-review`:

```bash
npm test
npm run typecheck
```

## Español

Extensión de Pi para extraer contenido de PDFs locales.

### Resumen

PDF Review permite leer texto, metadata y hash de archivos PDF para usarlo como contexto del agente. Puede renderizar páginas para detección visual y usar OCR opcional cuando el PDF no tiene capa de texto.

### Herramientas y capacidades

- `pdf_extract`: extrae texto, metadata, SHA-256, warnings y metadata de páginas renderizadas.
- OCR opcional con OCRmyPDF/Tesseract cuando `ocrMode` lo requiere.

### Requisitos

OCRmyPDF y Tesseract solo son necesarios si se usa OCR. La extracción normal de texto no requiere OCR.

### Ver más

La sección en inglés incluye parámetros, dependencias OCR y comandos de validación.
