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

Extensión de Pi para leer archivos PDF locales como contexto del agente.

### Herramientas

#### `pdf_extract`

Extrae texto, metadata del archivo, hash SHA-256, advertencias y metadata opcional de páginas renderizadas desde un PDF local.

Parámetros:

- `path` — ruta local del PDF, relativa al workspace actual o absoluta.
- `textCharsLimit` — cantidad máxima de caracteres de texto extraído que se devuelven; por defecto `50000`.
- `renderPages` — cuando es `true`, usa el flujo probado de screenshots de `pdf-parse` para renderizar metadata acotada de páginas. No se devuelven payloads de imagen en base64 para evitar saturar el contexto de la herramienta.
- `pagesLimit` — máximo de páginas renderizadas cuando `renderPages` está habilitado; por defecto `5`.
- `renderWidth` — ancho de render deseado; por defecto `1280`.
- `ocrMode` — `none` o `auto`. En `auto`, OCR se ejecuta solo cuando la capa de texto del PDF está vacía.
- `ocrProvider` — actualmente `ocrmypdf`.
- `ocrLanguage` — idioma OCR para OCRmyPDF/Tesseract, por ejemplo `eng`, `spa` o `spa+eng`; por defecto `eng`.

La implementación sigue el enfoque SIAS verificado: lee los bytes del PDF, calcula SHA-256, crea `PDFParse`, llama a `getText()`, opcionalmente llama a `getScreenshot()` y siempre destruye el parser. Si `ocrMode: "auto"` está habilitado y `getText()` no devuelve texto, la herramienta ejecuta OCRmyPDF con `--sidecar` para obtener texto OCR.

### Dependencia OCR

OCR es opcional. Para usar `ocrMode: "auto"` con `ocrProvider: "ocrmypdf"`, instala OCRmyPDF y sus dependencias del sistema (`tesseract`, Ghostscript y paquetes de idioma como español si hacen falta). Si OCRmyPDF no está disponible o falla, `pdf_extract` devuelve texto vacío junto con una advertencia `OCR_UNAVAILABLE` en vez de fallar toda la extracción.

### Validación

Ejecutar desde `extensions/pdf-review`:

```bash
npm test
npm run typecheck
```
