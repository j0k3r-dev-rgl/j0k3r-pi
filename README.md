# j0k3r Pi Agent Configuration

[English](#english) | [Español](#español)

## English

Personal/global Pi agent configuration used from `~/.pi/agent`. It contains the agent operating guide, workflow skills, markdown subagents, permission configuration, and local development copies of Pi extensions used by the coding agent.

### Layout

| Path | Purpose |
|---|---|
| [`AGENTS.md`](AGENTS.md) | Primary orchestrator instructions, workflow gates, TDD/commit policy, memory behavior, and safety rules. |
| [`skills/`](skills/) | Global/user skills used by the skill registry. These are routing-aware `SKILL.md` files for SDD, memory, permissions, subagents, Context7, and skill authoring. |
| [`subagents/`](subagents/) | Markdown-defined global/user subagents. SDD phase agents live here along with the read-only `discovery` agent. |
| [`extensions/`](extensions/) | Agent-dir extension implementations and their READMEs. In project-local installs these map to `.pi/extensions/*`. |
| [`docs/`](docs/) | Supporting docs for this agent configuration, such as [keyboard shortcuts](docs/keyboard-shortcuts.md). |
| [`subagents.json`](subagents.json) | Global/user subagent configuration and model profile defaults. |
| [`permissions.json`](permissions.json) | Global/user Permission Guard configuration. Project-local config may also live at `.pi/permissions.json`. |
| [`.pi/`](.pi/) | Project-local runtime/config data for this agent-dir repository, including memory backup config. |

### Installation

Clone this repository and install it into the Pi global agent directory (`~/.pi/agent` by default):

```bash
git clone https://github.com/j0k3r-dev-rgl/j0k3r-pi.git
cd j0k3r-pi
bash install.sh
```

The installer is a portable Bash script intended for Linux, macOS, and Windows environments that provide Bash, such as Git Bash or WSL. It copies the agent configuration into the Pi agent root and runs `npm install` inside each extension directory.

What it installs:

- `extensions/`
- `skills/`
- `subagents/`
- `AGENTS.md`
- `permissions.json`

What it intentionally does **not** install:

- `.git/`
- `.pi/` runtime/project data
- `sessions/`
- `auth.json`, `trust.json`, or other local secrets/runtime identity files
- `websearch.json` or other local runtime config files
- `node_modules/` from the checkout

Useful installer options:

```bash
bash install.sh --dry-run
bash install.sh --target "$HOME/.pi/agent"
bash install.sh --skip-npm
bash install.sh --no-backup
```

By default the installer backs up any replaced target files under `~/.pi/agent/.install-backups/<timestamp>/`. After installation, restart Pi or run `/reload` in an active session.

Manual installation is also possible: copy only the installed files/directories listed above into `~/.pi/agent`, then run `npm install` from each `~/.pi/agent/extensions/<extension-name>` directory.

### Core workflow

The agent is expected to be conservative and user-controlled:

1. Answer simple questions directly.
2. Treat investigation/review/diagnosis as read-only until the user approves a concrete implementation path.
3. Use the lightest safe workflow: inline, simple TDD, discovery, or full SDD/OpenSpec.
4. Treat policy-sensitive files (`AGENTS.md`, skills, subagents, permissions, memory/context config, workflow extensions) as higher-risk.
5. Use strict TDD for non-trivial code changes.
6. Never commit, branch, tag, rebase, or push unless the user explicitly asks in the current conversation.
7. Use memory as a curated persistent brain, not as a transcript dump.

See [`AGENTS.md`](AGENTS.md) for the full policy.

### Skill registry

[`extensions/skill-registry`](extensions/skill-registry/) generates `.pi/skill-registry.json` and `.pi/skill-registry.md` from both project-local and global/user skills.

The extension is opt-in at project scope: it only registers when `.pi/skill-registry.config.json` exists with `{"enabled": true}`. Missing or invalid config keeps it disabled. It has no dedicated environment variables; the config file is the project enable gate.

Scanned skill roots:

- `.pi/skills`
- `.agents/skills`
- `~/.pi/agent/skills`
- `~/.agents/skills`

Use the registry as the routing index. Agents should load selected skills from the path reported by the registry rather than assuming a fixed `.pi/skills/...` location.

Useful command/tool:

```text
/skill-registry generate
```

```json
{"write": false}
```

See [`extensions/skill-registry/README.md`](extensions/skill-registry/README.md) for behavior details.

### Extensions

| Extension | README | Purpose |
|---|---|---|
| Agent Todo | [`extensions/agent-todo/README.md`](extensions/agent-todo/README.md) | Single active task checklist for the current conversation branch, plus widget/provider integration. |
| API Tools | [`extensions/api-tools/README.md`](extensions/api-tools/README.md) | Project-local REST and GraphQL tools gated by exact `<ctx.cwd>/.pi/api.json`, with login/access-token persistence, per-request token use, bounded output, and secret-safe diagnostics. |
| Code Research | [`extensions/code-research/README.md`](extensions/code-research/README.md) | Tree-sitter-backed TypeScript, JavaScript, and Java symbol lookup, references, function call trees, and reverse call trees, plus Python workspace graph indexing. |
| Context7 | [`extensions/context7/README.md`](extensions/context7/README.md) | Safe, bounded Context7 library documentation tools without MCP. |
| Memory | [`extensions/memory/README.md`](extensions/memory/README.md) | Local-first project-aware persistent memory backed by SQLite/FTS5. Opt-in via `.pi/memory.json` with `enabled: true`. |
| PDF Review | [`extensions/pdf-review/README.md`](extensions/pdf-review/README.md) | Local PDF extraction with optional OCR via OCRmyPDF/Tesseract. |
| Permission Guard | [`extensions/permission-guard/README.md`](extensions/permission-guard/README.md) | In-process permission policy for supported tools and user bash commands. |
| Sidebar | [`extensions/sidebar/README.md`](extensions/sidebar/README.md) | HUD-style sidebar with chat, subagents, todo, and git status. |
| Skill Registry | [`extensions/skill-registry/README.md`](extensions/skill-registry/README.md) | Routing index generator for global and project skills. Opt-in via `.pi/skill-registry.config.json` with `enabled: true`; no dedicated environment variables. |
| Telegram Pi Control | [`extensions/telegram-pi-control/README.md`](extensions/telegram-pi-control/README.md) | Telegram gateway for authorized remote Pi session control. Requires Telegram bot/user environment variables. |
| Utils | [`extensions/utils/README.md`](extensions/utils/README.md) | General utility tools, currently Markdown-to-audio conversion using local Piper/eSpeak engines with Piper voice-model, MP3, bitrate, and progress-status support. |
| Websearch | [`extensions/websearch/README.md`](extensions/websearch/README.md) | Bounded web, community, GitHub, and research search with grouped public tool routers. Optional global config: `~/.pi/agent/websearch.json`; credentials are env-only. |
| YouTube Research | [`extensions/youtube-research/README.md`](extensions/youtube-research/README.md) | YouTube search, metadata, transcript, channel, and playlist research tools using `yt-dlp`. |

#### Extension quick reference

| Extension | Main tools/capabilities | Short description | More |
|---|---|---|---|
| Agent Todo | `agent_todo` | Maintains one active checklist for the current conversation branch, useful for multi-step implementation or validation work. | [Read more](extensions/agent-todo/README.md) |
| API Tools | Project REST/GraphQL tools | Exposes project-local API calls from `.pi/api.json`, including login/token handling and bounded, secret-safe responses. | [Read more](extensions/api-tools/README.md) |
| Code Research | `find_symbol`, `find_references`, `function_call_tree`, `reverse_function_call_tree`, `workspace_graph_status` | Provides code intelligence for TypeScript, JavaScript, and Java, with Python file/symbol indexing in the workspace graph. | [Read more](extensions/code-research/README.md) |
| Context7 | `context7_search_library`, `context7_get_context`, `context7_resolve_and_get_context` | Fetches focused library documentation through Context7 with bounded output and safe configuration. | [Read more](extensions/context7/README.md) |
| Memory | `memory_*` tools | Provides local-first persistent project memory, project profiles, session summaries, recall, import/export, and optional release provenance. | [Read more](extensions/memory/README.md) |
| PDF Review | `pdf_extract` | Extracts text and metadata from local PDFs, with optional OCR through OCRmyPDF/Tesseract. | [Read more](extensions/pdf-review/README.md) |
| Permission Guard | Tool and bash policy enforcement | Applies in-process safety rules for supported tools, bash commands, protected paths, approvals, and secret handling. | [Read more](extensions/permission-guard/README.md) |
| Sidebar | TUI sidebar/HUD | Adds a sidebar view for chat, subagents, todo state, and git status. | [Read more](extensions/sidebar/README.md) |
| Skill Registry | `skill_registry_generate`, `skill_registry_resolve` | Builds and queries the routing index for global and project skills. | [Read more](extensions/skill-registry/README.md) |
| Telegram Pi Control | Telegram remote-control gateway | Allows authorized Telegram-based interaction with Pi sessions when the required bot/user environment variables are configured. | [Read more](extensions/telegram-pi-control/README.md) |
| Utils | `markdown_to_audio` | Converts Markdown into local audio using Piper or eSpeak NG, with MP3 bitrate control and concise progress status. | [Read more](extensions/utils/README.md) |
| Websearch | `web_search`, discussion, research, GitHub helpers | Provides bounded web, community, GitHub, and academic/research search tools. | [Read more](extensions/websearch/README.md) |
| YouTube Research | YouTube search, video, transcript, channel, playlist tools | Searches and inspects YouTube videos, transcripts, channels, and playlists through `yt-dlp`-based tooling. | [Read more](extensions/youtube-research/README.md) |

After changing extension code, markdown subagents, skills, or config during an interactive Pi session, run `/reload` or restart Pi when the relevant README/skill says so.

Note: Memory and Skill Registry now default to disabled until the project explicitly opts in through their respective `.pi/*.json` config files.

### Validation commands

Run validation from each extension directory as needed:

```bash
cd extensions/<extension-name>
npm test
npm run typecheck
```

Examples:

```bash
cd extensions/memory
npm test
npm run typecheck
```

```bash
cd extensions/utils
npm test
npm run typecheck
```

```bash
cd extensions/websearch
npm test
npm run typecheck
```

Runtime notes:

- Memory requires a Node version with built-in `node:sqlite` support.
- Code Research uses Tree-sitter parser dependencies installed with the extension.
- YouTube Research requires `yt-dlp` on `PATH` at runtime.
- PDF Review OCR mode requires OCRmyPDF/Tesseract only when OCR is requested.
- Utils Markdown-to-audio requires a local TTS engine: `piper-tts`/`piper` with at least one Piper `.onnx` voice model, or `espeak-ng` fallback. `ffmpeg` is required only for MP3 output.

### Security notes

- Do not store secrets in skills, README files, memories, `.pi/*.json`, or extension config.
- Live Context7 calls require `CONTEXT7_API_KEY` in the Pi process environment, not in repository files.
- Skill Registry has no dedicated environment variables; project opt-in is controlled by `.pi/skill-registry.config.json` with `enabled: true`.
- Memory/cloud token fields should use environment variable names, never raw token values.
- Websearch credentials such as `EXA_API_KEY`, `PARALLEL_API_KEY`, `GITHUB_TOKEN`, `STACK_EXCHANGE_KEY`, `OPENALEX_MAILTO`, `CROSSREF_MAILTO`, and `SEMANTIC_SCHOLAR_API_KEY` belong in the process environment, not repository files.
- Telegram Pi Control requires `PI_TELEGRAM_CONTROL_BOT_TOKEN` and `PI_TELEGRAM_CONTROL_USER_ID` from environment or ignored local runtime files only.
- Permission Guard is an in-process guard, not an OS sandbox.
- Emergency `bypassAll` settings disable normal guard behavior; inspect active config before enforcement validation.

### Subagents

The Subagents extension is maintained as an independent package at [`j0k3r-dev-rgl/pi-subagents-j0k3r`](https://github.com/j0k3r-dev-rgl/pi-subagents-j0k3r). This repository keeps only the global/user markdown subagent definitions and related configuration.

Current global/user subagents are under [`subagents/*.md`](subagents/):

- [`discovery`](subagents/discovery.md) — read-only standalone/pre-SDD research.
- [`prd-review`](subagents/prd-review.md) — PRD readiness, ambiguity, and requirement debt review.
- [`sdd-explore`](subagents/sdd-explore.md) — formal SDD exploration.
- [`sdd-proposal`](subagents/sdd-proposal.md) — PRD/product proposal.
- [`sdd-spec`](subagents/sdd-spec.md) — normative requirements/spec.
- [`sdd-design`](subagents/sdd-design.md) — technical design.
- [`sdd-task`](subagents/sdd-task.md) — implementation task plan.
- [`sdd-apply`](subagents/sdd-apply.md) — approved implementation tasks.
- [`sdd-verify`](subagents/sdd-verify.md) — verification without fixing.
- [`sdd-archive`](subagents/sdd-archive.md) — archive verified SDD changes.

The main agent remains the orchestrator. Subagents must not delegate to other subagents.

### Documentation maintenance

Extension READMEs should describe the implementation in this checkout using repo-relative paths like `extensions/<name>`. When useful, also mention the project-local equivalent `.pi/extensions/<name>`. Keep related-doc links limited to files that exist in this repository unless intentionally referencing external Pi docs.

---

## Español

Configuración global/personal de Pi usada desde `~/.pi/agent`. Contiene la guía operativa del agente, skills de workflow, subagentes Markdown, configuración de permisos y copias locales de extensiones de Pi usadas por el agente de código.

### Estructura

| Ruta | Propósito |
|---|---|
| [`AGENTS.md`](AGENTS.md) | Instrucciones principales del orquestador, gates de workflow, política de TDD/commits, memoria y seguridad. |
| [`skills/`](skills/) | Skills globales/de usuario usadas por el Skill Registry. Son archivos `SKILL.md` con reglas de routing para SDD, memoria, permisos, subagentes, Context7 y autoría de skills. |
| [`subagents/`](subagents/) | Subagentes globales/de usuario definidos en Markdown. Aquí viven los agentes de fases SDD y el agente `discovery` de solo lectura. |
| [`extensions/`](extensions/) | Implementaciones de extensiones del directorio de agente y sus READMEs. En instalaciones por proyecto equivalen a `.pi/extensions/*`. |
| [`docs/`](docs/) | Documentos de apoyo para esta configuración, como [atajos de teclado](docs/keyboard-shortcuts.md). |
| [`subagents.json`](subagents.json) | Configuración global/de usuario para subagentes y perfiles de modelo. |
| [`permissions.json`](permissions.json) | Configuración global/de usuario de Permission Guard. También puede existir configuración por proyecto en `.pi/permissions.json`. |
| [`.pi/`](.pi/) | Datos runtime/config locales de este repositorio, incluyendo configuración de backup de memoria. |

### Instalación

Clona este repositorio e instálalo en el directorio global de agente de Pi (`~/.pi/agent` por defecto):

```bash
git clone https://github.com/j0k3r-dev-rgl/j0k3r-pi.git
cd j0k3r-pi
bash install.sh
```

El instalador es un script Bash portable para Linux, macOS y entornos Windows con Bash, como Git Bash o WSL. Copia la configuración al directorio de agente de Pi y ejecuta `npm install` dentro de cada extensión.

Qué instala:

- `extensions/`
- `skills/`
- `subagents/`
- `AGENTS.md`
- `permissions.json`

Qué **no** instala intencionalmente:

- `.git/`
- datos runtime/de proyecto en `.pi/`
- `sessions/`
- `auth.json`, `trust.json` u otros archivos locales de secretos/identidad runtime
- `websearch.json` u otros archivos locales de configuración runtime
- `node_modules/` del checkout

Opciones útiles:

```bash
bash install.sh --dry-run
bash install.sh --target "$HOME/.pi/agent"
bash install.sh --skip-npm
bash install.sh --no-backup
```

Por defecto, el instalador crea backups de archivos reemplazados en `~/.pi/agent/.install-backups/<timestamp>/`. Después de instalar, reinicia Pi o ejecuta `/reload` en una sesión activa.

También se puede instalar manualmente: copia solo los archivos/directorios listados arriba dentro de `~/.pi/agent` y luego ejecuta `npm install` desde cada directorio `~/.pi/agent/extensions/<nombre-de-extensión>`.

### Workflow principal

El agente debe ser conservador y dejar al usuario en control:

1. Responder preguntas simples directamente.
2. Tratar investigación, revisión y diagnóstico como solo lectura hasta que el usuario apruebe una ruta concreta de implementación.
3. Usar el workflow seguro más liviano: inline, simple TDD, discovery o SDD/OpenSpec completo.
4. Tratar archivos sensibles de política (`AGENTS.md`, skills, subagentes, permisos, configuración de memoria/contexto y extensiones de workflow) como superficies de mayor riesgo.
5. Usar TDD estricto para cambios de código no triviales.
6. Nunca hacer commits, branches, tags, rebases o pushes salvo pedido explícito del usuario en la conversación actual.
7. Usar la memoria como cerebro persistente curado, no como volcado de transcript.

Ver [`AGENTS.md`](AGENTS.md) para la política completa.

### Skill Registry

[`extensions/skill-registry`](extensions/skill-registry/) genera `.pi/skill-registry.json` y `.pi/skill-registry.md` desde skills locales de proyecto y skills globales/de usuario.

La extensión es opt-in por proyecto: solo se registra cuando existe `.pi/skill-registry.config.json` con `{"enabled": true}`. Si falta o es inválido, permanece deshabilitada. No tiene variables de entorno dedicadas; el archivo de configuración es la compuerta de activación.

Raíces de skills escaneadas:

- `.pi/skills`
- `.agents/skills`
- `~/.pi/agent/skills`
- `~/.agents/skills`

Usa el registry como índice de routing. Los agentes deben cargar las skills desde la ruta reportada por el registry, no asumir una ubicación fija como `.pi/skills/...`.

Comando/tool útil:

```text
/skill-registry generate
```

```json
{"write": false}
```

Ver [`extensions/skill-registry/README.md`](extensions/skill-registry/README.md) para detalles de comportamiento.

### Extensiones

| Extensión | README | Propósito |
|---|---|---|
| Agent Todo | [`extensions/agent-todo/README.md`](extensions/agent-todo/README.md) | Checklist de una sola tarea activa para la rama de conversación actual, más integración de widget/provider. |
| API Tools | [`extensions/api-tools/README.md`](extensions/api-tools/README.md) | Herramientas REST y GraphQL por proyecto, activadas por `<ctx.cwd>/.pi/api.json`, con login/token, uso de token por request, salida acotada y diagnósticos seguros. |
| Code Research | [`extensions/code-research/README.md`](extensions/code-research/README.md) | Búsqueda de símbolos, referencias, call trees y reverse call trees para TypeScript, JavaScript y Java usando Tree-sitter, más indexado Python en el workspace graph. |
| Context7 | [`extensions/context7/README.md`](extensions/context7/README.md) | Herramientas seguras y acotadas para documentación de librerías con Context7, sin MCP. |
| Memory | [`extensions/memory/README.md`](extensions/memory/README.md) | Memoria persistente local-first, consciente del proyecto, basada en SQLite/FTS5. Opt-in vía `.pi/memory.json` con `enabled: true`. |
| PDF Review | [`extensions/pdf-review/README.md`](extensions/pdf-review/README.md) | Extracción local de PDF con OCR opcional vía OCRmyPDF/Tesseract. |
| Permission Guard | [`extensions/permission-guard/README.md`](extensions/permission-guard/README.md) | Política de permisos in-process para herramientas soportadas y comandos bash del usuario. |
| Sidebar | [`extensions/sidebar/README.md`](extensions/sidebar/README.md) | Sidebar tipo HUD con chat, subagentes, todo y estado de git. |
| Skill Registry | [`extensions/skill-registry/README.md`](extensions/skill-registry/README.md) | Generador de índice de routing para skills globales y de proyecto. Opt-in vía `.pi/skill-registry.config.json` con `enabled: true`; sin variables de entorno dedicadas. |
| Telegram Pi Control | [`extensions/telegram-pi-control/README.md`](extensions/telegram-pi-control/README.md) | Gateway de Telegram para control remoto autorizado de sesiones Pi. Requiere variables de entorno de bot/usuario de Telegram. |
| Utils | [`extensions/utils/README.md`](extensions/utils/README.md) | Utilidades generales; actualmente conversión de Markdown a audio con Piper/eSpeak local, voces Piper, MP3, bitrate y progreso en status bar. |
| Websearch | [`extensions/websearch/README.md`](extensions/websearch/README.md) | Búsqueda web, comunidades, GitHub e investigación con salida acotada y routers públicos agrupados. Config opcional global: `~/.pi/agent/websearch.json`; credenciales solo por entorno. |
| YouTube Research | [`extensions/youtube-research/README.md`](extensions/youtube-research/README.md) | Búsqueda de YouTube, metadata, transcripciones, canales y playlists usando `yt-dlp`. |

#### Referencia rápida de extensiones

| Extensión | Herramientas/capacidades principales | Descripción breve | Más información |
|---|---|---|---|
| Agent Todo | `agent_todo` | Mantiene una checklist activa para la rama de conversación actual; útil en trabajos de implementación o validación con varios pasos. | [Ver más](extensions/agent-todo/README.md) |
| API Tools | Herramientas REST/GraphQL del proyecto | Expone llamadas API locales definidas en `.pi/api.json`, con login/token, respuestas acotadas y diagnósticos seguros. | [Ver más](extensions/api-tools/README.md) |
| Code Research | `find_symbol`, `find_references`, `function_call_tree`, `reverse_function_call_tree`, `workspace_graph_status` | Aporta inteligencia de código para TypeScript, JavaScript y Java, con indexado de archivos/símbolos Python en el workspace graph. | [Ver más](extensions/code-research/README.md) |
| Context7 | `context7_search_library`, `context7_get_context`, `context7_resolve_and_get_context` | Obtiene documentación enfocada de librerías con Context7, salida acotada y configuración segura. | [Ver más](extensions/context7/README.md) |
| Memory | Herramientas `memory_*` | Provee memoria persistente local-first, perfiles de proyecto, resúmenes de sesión, recall, import/export y provenance opcional de releases. | [Ver más](extensions/memory/README.md) |
| PDF Review | `pdf_extract` | Extrae texto y metadata de PDFs locales, con OCR opcional mediante OCRmyPDF/Tesseract. | [Ver más](extensions/pdf-review/README.md) |
| Permission Guard | Políticas para tools y bash | Aplica reglas de seguridad in-process para tools soportadas, comandos bash, rutas protegidas, aprobaciones y secretos. | [Ver más](extensions/permission-guard/README.md) |
| Sidebar | Sidebar/HUD de TUI | Agrega una vista lateral para chat, subagentes, estado de todo y estado de git. | [Ver más](extensions/sidebar/README.md) |
| Skill Registry | `skill_registry_generate`, `skill_registry_resolve` | Construye y consulta el índice de routing para skills globales y de proyecto. | [Ver más](extensions/skill-registry/README.md) |
| Telegram Pi Control | Gateway remoto por Telegram | Permite interacción autorizada con sesiones Pi desde Telegram cuando están configuradas las variables de entorno necesarias. | [Ver más](extensions/telegram-pi-control/README.md) |
| Utils | `markdown_to_audio` | Convierte Markdown a audio local con Piper o eSpeak NG, control de bitrate MP3 y progreso compacto en status bar. | [Ver más](extensions/utils/README.md) |
| Websearch | `web_search`, herramientas de discusión, investigación y GitHub | Provee búsquedas acotadas en web, comunidades, GitHub y fuentes académicas/de investigación. | [Ver más](extensions/websearch/README.md) |
| YouTube Research | Herramientas de búsqueda, video, transcripción, canal y playlist | Busca e inspecciona videos, transcripciones, canales y playlists de YouTube mediante herramientas basadas en `yt-dlp`. | [Ver más](extensions/youtube-research/README.md) |

Después de cambiar código de extensiones, subagentes Markdown, skills o configuración durante una sesión interactiva de Pi, ejecuta `/reload` o reinicia Pi cuando el README/skill correspondiente lo indique.

Nota: Memory y Skill Registry ahora están deshabilitadas por defecto hasta que el proyecto active explícitamente sus respectivos archivos `.pi/*.json`.

### Comandos de validación

Ejecuta validación desde cada directorio de extensión según sea necesario:

```bash
cd extensions/<nombre-de-extensión>
npm test
npm run typecheck
```

Ejemplos:

```bash
cd extensions/memory
npm test
npm run typecheck
```

```bash
cd extensions/utils
npm test
npm run typecheck
```

```bash
cd extensions/websearch
npm test
npm run typecheck
```

Notas runtime:

- Memory requiere una versión de Node con soporte integrado de `node:sqlite`.
- Code Research usa dependencias de parser Tree-sitter instaladas con la extensión.
- YouTube Research requiere `yt-dlp` en `PATH`.
- PDF Review en modo OCR requiere OCRmyPDF/Tesseract solo cuando se solicita OCR.
- Utils Markdown-to-audio requiere un motor TTS local: `piper-tts`/`piper` con al menos una voz Piper `.onnx`, o fallback `espeak-ng`. `ffmpeg` solo es necesario para salida MP3.

### Notas de seguridad

- No guardes secretos en skills, README, memorias, `.pi/*.json` o configuración de extensiones.
- Las llamadas live de Context7 requieren `CONTEXT7_API_KEY` en el entorno del proceso Pi, no en archivos del repositorio.
- Skill Registry no tiene variables de entorno dedicadas; el opt-in por proyecto se controla con `.pi/skill-registry.config.json` y `enabled: true`.
- Los campos de token de Memory/cloud deben usar nombres de variables de entorno, nunca valores de tokens reales.
- Credenciales de Websearch como `EXA_API_KEY`, `PARALLEL_API_KEY`, `GITHUB_TOKEN`, `STACK_EXCHANGE_KEY`, `OPENALEX_MAILTO`, `CROSSREF_MAILTO` y `SEMANTIC_SCHOLAR_API_KEY` deben vivir en el entorno del proceso, no en archivos del repositorio.
- Telegram Pi Control requiere `PI_TELEGRAM_CONTROL_BOT_TOKEN` y `PI_TELEGRAM_CONTROL_USER_ID` desde variables de entorno o archivos runtime locales ignorados.
- Permission Guard es una protección in-process, no un sandbox de sistema operativo.
- Configuraciones de emergencia como `bypassAll` deshabilitan el comportamiento normal del guard; inspecciona la configuración activa antes de validar enforcement.

### Subagentes

La extensión Subagents se mantiene como paquete independiente en [`j0k3r-dev-rgl/pi-subagents-j0k3r`](https://github.com/j0k3r-dev-rgl/pi-subagents-j0k3r). Este repositorio conserva solo las definiciones Markdown globales/de usuario y la configuración relacionada.

Los subagentes globales/de usuario actuales están en [`subagents/*.md`](subagents/):

- [`discovery`](subagents/discovery.md) — investigación standalone/pre-SDD de solo lectura.
- [`prd-review`](subagents/prd-review.md) — revisión de preparación de PRD, ambigüedad y deuda de requisitos.
- [`sdd-explore`](subagents/sdd-explore.md) — exploración formal SDD.
- [`sdd-proposal`](subagents/sdd-proposal.md) — propuesta de producto/PRD.
- [`sdd-spec`](subagents/sdd-spec.md) — requisitos/spec normativos.
- [`sdd-design`](subagents/sdd-design.md) — diseño técnico.
- [`sdd-task`](subagents/sdd-task.md) — plan de tareas de implementación.
- [`sdd-apply`](subagents/sdd-apply.md) — tareas de implementación aprobadas.
- [`sdd-verify`](subagents/sdd-verify.md) — verificación sin arreglar.
- [`sdd-archive`](subagents/sdd-archive.md) — archivo de cambios SDD verificados.

El agente principal sigue siendo el orquestador. Los subagentes no deben delegar a otros subagentes.

### Mantenimiento de documentación

Los READMEs de extensiones deben describir la implementación de este checkout usando rutas relativas al repo como `extensions/<name>`. Cuando sea útil, también pueden mencionar el equivalente local por proyecto `.pi/extensions/<name>`. Mantén links a documentos relacionados limitados a archivos que existen en este repositorio, salvo referencias intencionales a documentación externa de Pi.
