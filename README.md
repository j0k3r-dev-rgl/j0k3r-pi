# j0k3r Pi Agent Configuration

[English](#english) | [Español](#español)

## English

Personal/global Pi agent configuration used from `~/.pi/agent`. It contains the agent operating guide, workflow skills, Markdown subagents, permission configuration, local extension copies, and external Pi packages managed by the installer.

### Layout

| Path | Purpose |
|---|---|
| [`AGENTS.md`](AGENTS.md) | Primary orchestrator instructions, workflow gates, TDD/commit policy, memory behavior, and safety rules. |
| [`skills/`](skills/) | Global/user skills used by the skill registry. These are routing-aware `SKILL.md` files for SDD, TDD, permissions, subagents, extension configuration, documentation, and skill authoring. |
| [`subagents/`](subagents/) | Markdown-defined global/user subagents. SDD phase agents live here along with the read-only `discovery` agent. |
| [`extensions/`](extensions/) | Agent-dir extension implementations and their READMEs. In project-local installs these map to `.pi/extensions/*`. |
| [`docs/`](docs/) | Supporting docs for this agent configuration, such as [keyboard shortcuts](docs/keyboard-shortcuts.md). |
| [`subagents.json`](subagents.json) | Global/user subagent configuration and model profile defaults. |
| [`permissions.json`](permissions.json) | Global/user Permission Guard configuration. Project-local config may also live at `.pi/permissions.json`. |
| [`install.sh`](install.sh) | First-time installer for copying the managed configuration into a separate Pi agent directory. |
| [`update.sh`](update.sh) | Git-free, non-destructive updater for an existing Pi agent directory, with backup and package refresh. |
| [`.pi/`](.pi/) | Project-local runtime/config data for this repository, including Code Research and Skill Registry configuration. |

### Installation

Prerequisites: the `pi` CLI, Node.js/npm, `tar`, `cmp`, `find`, and Bash. On Windows, use an environment that provides Bash, such as Git Bash or WSL.

Clone the repository and run the installer. One command sequence copies the managed agent files, installs every local extension dependency, and installs the external Pi packages:

```bash
git clone https://github.com/j0k3r-dev-rgl/j0k3r-pi.git
cd j0k3r-pi
bash install.sh
```

The default target is `~/.pi/agent`. The installer:

1. Copies `extensions/`, `skills/`, `subagents/`, `AGENTS.md`, `permissions.json`, and `subagents.json`.
2. Runs `npm install` in every copied extension that has a `package.json`.
3. Runs Pi's package manager for the following unversioned packages:

| Pi package | Purpose |
|---|---|
| [`npm:pi-subagents-j0k3r`](https://www.npmjs.com/package/pi-subagents-j0k3r) | Runtime support for the Markdown-defined subagents in this configuration. |
| [`npm:gentle-engram`](https://www.npmjs.com/package/gentle-engram) | Pi-native persistent memory backed by Engram. |

`pi install` creates the target `settings.json` when it does not exist, preserves its existing settings, and adds or deduplicates both entries in `packages`. It also installs or refreshes their current npm releases under the target `npm/` directory. A custom `--target` is forwarded to Pi through `PI_CODING_AGENT_DIR`, so package data and settings are written to that target instead of the default agent directory.

The installer intentionally excludes:

- `.git/`
- `.pi/` runtime/project data
- `sessions/`
- `auth.json`, `trust.json`, and other local secrets/runtime identity files
- `websearch.json` and other local runtime config files
- existing `node_modules/` from the checkout; dependencies are installed fresh in the target

Useful options:

```bash
bash install.sh --dry-run
bash install.sh --target "$HOME/.pi/agent"
bash install.sh --skip-npm
bash install.sh --no-backup
```

`--skip-npm` copies the configuration but skips both local extension dependencies and Pi package installation. Run the installer again without this option to install them. By default, replaced target files are backed up under `~/.pi/agent/.install-backups/<timestamp>/`.

### Updating an existing installation

Download and extract a current copy of this distribution, then run its updater. The target must already exist; use `install.sh` for a first-time installation.

```bash
bash update.sh
```

The updater does not use Git. Before changing anything, it creates a compressed snapshot under `~/.pi/agent/.update-backups/<timestamp>-<pid>/agent.tar.gz`. The backup includes the complete target agent directory except:

- `.update-backups/` itself;
- `auth.json` and `trust.json`;
- `.env` and `.env.*`;
- `*.key` and `*.pem`.

These excluded files remain untouched in the live target; they are omitted only from the backup archive. The updater then merges the managed `extensions/`, `skills/`, `subagents/`, `AGENTS.md`, `permissions.json`, and `subagents.json` into the target. Only missing or byte-different regular files are copied. Identical files are not rewritten, and the merge never deletes target-only files. Finally, it runs `npm install` for each managed extension and updates package-managed Pi extensions with `pi update --extensions`; those package managers may independently manage files inside their own dependency/package directories.

Useful options:

```bash
bash update.sh --dry-run
bash update.sh --target "$HOME/.pi/agent"
bash update.sh --skip-npm
```

`--dry-run` reports backup, copy, and package actions without changing the target. `--skip-npm` still creates the backup and updates managed files, but skips npm and Pi package commands.

To refresh only package-managed Pi extensions manually:

```bash
PI_CODING_AGENT_DIR="/path/to/agent" pi update --extensions
```

After installation or update, restart Pi or run `/reload` in an active session.

For a manual installation, copy the managed files listed above and run:

```bash
TARGET_DIR="$HOME/.pi/agent"
for extension_dir in "$TARGET_DIR"/extensions/*; do
  [ -f "$extension_dir/package.json" ] || continue
  (cd "$extension_dir" && npm install)
done
PI_CODING_AGENT_DIR="$TARGET_DIR" pi install npm:pi-subagents-j0k3r
PI_CODING_AGENT_DIR="$TARGET_DIR" pi install npm:gentle-engram
```

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
| Browser Screenshot | [`extensions/browser-screenshot/README.md`](extensions/browser-screenshot/README.md) | Read-only Chrome DevTools Protocol status, tab listing, and screenshots without launching or navigating the browser. |
| Code Research | [`extensions/code-research/README.md`](extensions/code-research/README.md) | Tree-sitter-backed TypeScript, JavaScript, and Java symbol lookup, references, function call trees, and reverse call trees, plus Python workspace graph indexing. |
| Context7 | [`extensions/context7/README.md`](extensions/context7/README.md) | Safe, bounded Context7 library documentation tools without MCP. |
| PDF Review | [`extensions/pdf-review/README.md`](extensions/pdf-review/README.md) | Local PDF extraction with optional OCR via OCRmyPDF/Tesseract. |
| Permission Guard | [`extensions/permission-guard/README.md`](extensions/permission-guard/README.md) | In-process permission policy for supported tools and user bash commands. |
| Sidebar | [`extensions/sidebar/README.md`](extensions/sidebar/README.md) | HUD-style sidebar with chat, subagents, todo, and git status. |
| Skill Registry | [`extensions/skill-registry/README.md`](extensions/skill-registry/README.md) | Routing index generator for global and project skills. Opt-in via `.pi/skill-registry.config.json` with `enabled: true`; no dedicated environment variables. |
| Utils | [`extensions/utils/README.md`](extensions/utils/README.md) | General utility tools, currently Markdown-to-audio conversion using local Piper/eSpeak engines with Piper voice-model, MP3, bitrate, and progress-status support. |
| Websearch | [`extensions/websearch/README.md`](extensions/websearch/README.md) | Bounded web, community, GitHub, and research search with grouped public tool routers. Optional global config: `~/.pi/agent/websearch.json`; credentials are env-only. |
| Workspace Services | [`extensions/workspace-services/README.md`](extensions/workspace-services/README.md) | Management of manually configured workspace services, including lifecycle, status, and bounded local logs. |
| YouTube Research | [`extensions/youtube-research/README.md`](extensions/youtube-research/README.md) | YouTube search, metadata, transcript, channel, and playlist research tools using `yt-dlp`. |

#### Extension quick reference

| Extension | Main tools/capabilities | Short description | More |
|---|---|---|---|
| Agent Todo | `agent_todo` | Maintains one active checklist for the current conversation branch, useful for multi-step implementation or validation work. | [Read more](extensions/agent-todo/README.md) |
| API Tools | Project REST/GraphQL tools | Exposes project-local API calls from `.pi/api.json`, including login/token handling and bounded, secret-safe responses. | [Read more](extensions/api-tools/README.md) |
| Browser Screenshot | `browser_cdp_status`, `browser_tabs_list`, `browser_page_screenshot` | Inspects existing Chrome CDP tabs and captures screenshots without navigation or focus changes. | [Read more](extensions/browser-screenshot/README.md) |
| Code Research | `find_symbol`, `find_references`, `function_call_tree`, `reverse_function_call_tree`, `workspace_graph_status` | Provides code intelligence for TypeScript, JavaScript, and Java, with Python file/symbol indexing in the workspace graph. | [Read more](extensions/code-research/README.md) |
| Context7 | `context7_search_library`, `context7_get_context`, `context7_resolve_and_get_context` | Fetches focused library documentation through Context7 with bounded output and safe configuration. | [Read more](extensions/context7/README.md) |
| PDF Review | `pdf_extract` | Extracts text and metadata from local PDFs, with optional OCR through OCRmyPDF/Tesseract. | [Read more](extensions/pdf-review/README.md) |
| Permission Guard | Tool and bash policy enforcement | Applies in-process safety rules for supported tools, bash commands, protected paths, approvals, and secret handling. | [Read more](extensions/permission-guard/README.md) |
| Sidebar | TUI sidebar/HUD | Adds a sidebar view for chat, subagents, todo state, and git status. | [Read more](extensions/sidebar/README.md) |
| Skill Registry | `skill_registry_generate`, `skill_registry_resolve` | Builds and queries the routing index for global and project skills. | [Read more](extensions/skill-registry/README.md) |
| Utils | `markdown_to_audio` | Converts Markdown into local audio using Piper or eSpeak NG, with MP3 bitrate control and concise progress status. | [Read more](extensions/utils/README.md) |
| Websearch | `web_search`, discussion, research, GitHub helpers | Provides bounded web, community, GitHub, and academic/research search tools. | [Read more](extensions/websearch/README.md) |
| Workspace Services | `workspace_services_*`, `workspace_service_*` | Manages only the services declared in `.pi/workspace-services.json`, with local process state and bounded logs. | [Read more](extensions/workspace-services/README.md) |
| YouTube Research | YouTube search, video, transcript, channel, playlist tools | Searches and inspects YouTube videos, transcripts, channels, and playlists through `yt-dlp`-based tooling. | [Read more](extensions/youtube-research/README.md) |

After changing extension code, markdown subagents, skills, or config during an interactive Pi session, run `/reload` or restart Pi when the relevant README/skill says so.

Note: Skill Registry is disabled until a project explicitly opts in through `.pi/skill-registry.config.json`.

### Validation commands

Validate the installer and updater without changing the real agent directory:

```bash
bash tests/install_test.sh
bash tests/update_test.sh
```

Run extension validation from each extension directory as needed:

```bash
cd extensions/<extension-name>
npm test
npm run typecheck
```

Examples:

```bash
cd extensions/browser-screenshot
npm test
npm run typecheck
```

```bash
cd extensions/utils
npm test
npm run typecheck
```

```bash
cd extensions/workspace-services
npm test
npm run typecheck
```

Runtime notes:

- Code Research uses Tree-sitter parser dependencies installed with the extension.
- YouTube Research requires `yt-dlp` on `PATH` at runtime.
- PDF Review OCR mode requires OCRmyPDF/Tesseract only when OCR is requested.
- Utils Markdown-to-audio requires a local TTS engine: `piper-tts`/`piper` with at least one Piper `.onnx` voice model, or `espeak-ng` fallback. `ffmpeg` is required only for MP3 output.

### Security notes

- Do not store secrets in skills, README files, memories, `.pi/*.json`, or extension config.
- Live Context7 calls require `CONTEXT7_API_KEY` in the Pi process environment, not in repository files.
- Skill Registry has no dedicated environment variables; project opt-in is controlled by `.pi/skill-registry.config.json` with `enabled: true`.
- Websearch credentials such as `EXA_API_KEY`, `PARALLEL_API_KEY`, `GITHUB_TOKEN`, `STACK_EXCHANGE_KEY`, `OPENALEX_MAILTO`, `CROSSREF_MAILTO`, and `SEMANTIC_SCHOLAR_API_KEY` belong in the process environment, not repository files.
- Permission Guard is an in-process guard, not an OS sandbox.
- Emergency `bypassAll` settings disable normal guard behavior; inspect active config before enforcement validation.

### Subagents

The Subagents extension is maintained as the independent [`pi-subagents-j0k3r`](https://github.com/j0k3r-dev-rgl/pi-subagents-j0k3r) package. The installer installs or refreshes that package, while this repository keeps the global/user Markdown subagent definitions and related configuration.

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

Configuración global/personal de Pi usada desde `~/.pi/agent`. Contiene la guía operativa del agente, skills de workflow, subagentes Markdown, configuración de permisos, copias locales de extensiones y paquetes externos de Pi gestionados por el instalador.

### Estructura

| Ruta | Propósito |
|---|---|
| [`AGENTS.md`](AGENTS.md) | Instrucciones principales del orquestador, gates de workflow, política de TDD/commits, memoria y seguridad. |
| [`skills/`](skills/) | Skills globales/de usuario usadas por el Skill Registry. Son archivos `SKILL.md` con reglas de routing para SDD, TDD, permisos, subagentes, configuración de extensiones, documentación y autoría de skills. |
| [`subagents/`](subagents/) | Subagentes globales/de usuario definidos en Markdown. Aquí viven los agentes de fases SDD y el agente `discovery` de solo lectura. |
| [`extensions/`](extensions/) | Implementaciones de extensiones del directorio de agente y sus READMEs. En instalaciones por proyecto equivalen a `.pi/extensions/*`. |
| [`docs/`](docs/) | Documentos de apoyo para esta configuración, como [atajos de teclado](docs/keyboard-shortcuts.md). |
| [`subagents.json`](subagents.json) | Configuración global/de usuario para subagentes y perfiles de modelo. |
| [`permissions.json`](permissions.json) | Configuración global/de usuario de Permission Guard. También puede existir configuración por proyecto en `.pi/permissions.json`. |
| [`install.sh`](install.sh) | Instalador inicial que copia la configuración gestionada a un directorio de agente Pi separado. |
| [`update.sh`](update.sh) | Actualizador sin Git y no destructivo para una instalación existente, con backup y actualización de paquetes. |
| [`.pi/`](.pi/) | Datos runtime/config locales de este repositorio, incluyendo configuración de Code Research y Skill Registry. |

### Instalación

Requisitos: CLI `pi`, Node.js/npm, `tar`, `cmp`, `find` y Bash. En Windows, usa un entorno con Bash, como Git Bash o WSL.

Clona el repositorio y ejecuta el instalador. Esta única secuencia copia los archivos de agente gestionados, instala las dependencias de cada extensión local e instala los paquetes externos de Pi:

```bash
git clone https://github.com/j0k3r-dev-rgl/j0k3r-pi.git
cd j0k3r-pi
bash install.sh
```

El destino predeterminado es `~/.pi/agent`. El instalador:

1. Copia `extensions/`, `skills/`, `subagents/`, `AGENTS.md`, `permissions.json` y `subagents.json`.
2. Ejecuta `npm install` en cada extensión copiada que contenga un `package.json`.
3. Ejecuta el gestor de paquetes de Pi para estos paquetes sin versión fijada:

| Paquete Pi | Propósito |
|---|---|
| [`npm:pi-subagents-j0k3r`](https://www.npmjs.com/package/pi-subagents-j0k3r) | Soporte runtime para los subagentes definidos en Markdown de esta configuración. |
| [`npm:gentle-engram`](https://www.npmjs.com/package/gentle-engram) | Memoria persistente nativa de Pi respaldada por Engram. |

`pi install` crea el `settings.json` del destino si no existe, conserva su configuración y agrega o deduplica ambas entradas dentro de `packages`. También instala o actualiza sus versiones npm actuales dentro del directorio `npm/` del destino. Cuando se usa `--target`, el instalador lo propaga a Pi mediante `PI_CODING_AGENT_DIR`, evitando escribir en el directorio de agente predeterminado.

El instalador excluye intencionalmente:

- `.git/`
- datos runtime/de proyecto en `.pi/`
- `sessions/`
- `auth.json`, `trust.json` y otros archivos locales de secretos/identidad runtime
- `websearch.json` y otros archivos locales de configuración runtime
- los `node_modules/` existentes en el checkout; las dependencias se instalan desde cero en el destino

Opciones útiles:

```bash
bash install.sh --dry-run
bash install.sh --target "$HOME/.pi/agent"
bash install.sh --skip-npm
bash install.sh --no-backup
```

`--skip-npm` copia la configuración, pero omite tanto las dependencias de las extensiones locales como los paquetes de Pi. Ejecuta nuevamente el instalador sin esta opción para instalarlos. Por defecto, los archivos reemplazados se respaldan en `~/.pi/agent/.install-backups/<timestamp>/`.

### Actualizar una instalación existente

Descarga y extrae una copia actual de esta distribución y ejecuta su actualizador. El destino debe existir; usa `install.sh` para una instalación inicial.

```bash
bash update.sh
```

El actualizador no usa Git. Antes de cambiar nada, crea una copia comprimida en `~/.pi/agent/.update-backups/<timestamp>-<pid>/agent.tar.gz`. El backup incluye todo el directorio del agente de destino excepto:

- el propio directorio `.update-backups/`;
- `auth.json` y `trust.json`;
- `.env` y `.env.*`;
- `*.key` y `*.pem`.

Estos archivos excluidos permanecen intactos en el destino activo; solo se omiten del backup. Después, el actualizador fusiona `extensions/`, `skills/`, `subagents/`, `AGENTS.md`, `permissions.json` y `subagents.json` con el destino. Solo copia archivos regulares ausentes o cuyo contenido sea distinto. No reescribe archivos idénticos y el merge nunca elimina archivos que existan únicamente en el destino. Finalmente, ejecuta `npm install` para cada extensión gestionada y actualiza los paquetes de Pi mediante `pi update --extensions`; esos gestores pueden administrar por separado los archivos dentro de sus propios directorios de dependencias o paquetes.

Opciones útiles:

```bash
bash update.sh --dry-run
bash update.sh --target "$HOME/.pi/agent"
bash update.sh --skip-npm
```

`--dry-run` muestra las acciones de backup, copia y paquetes sin modificar el destino. `--skip-npm` conserva el backup y la actualización de archivos gestionados, pero omite los comandos npm y Pi.

Para actualizar manualmente solo las extensiones gestionadas como paquetes de Pi:

```bash
PI_CODING_AGENT_DIR="/ruta/al/agent" pi update --extensions
```

Después de instalar o actualizar, reinicia Pi o ejecuta `/reload` en una sesión activa.

Para una instalación manual, copia los archivos gestionados listados arriba y ejecuta:

```bash
TARGET_DIR="$HOME/.pi/agent"
for extension_dir in "$TARGET_DIR"/extensions/*; do
  [ -f "$extension_dir/package.json" ] || continue
  (cd "$extension_dir" && npm install)
done
PI_CODING_AGENT_DIR="$TARGET_DIR" pi install npm:pi-subagents-j0k3r
PI_CODING_AGENT_DIR="$TARGET_DIR" pi install npm:gentle-engram
```

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
| Browser Screenshot | [`extensions/browser-screenshot/README.md`](extensions/browser-screenshot/README.md) | Estado, listado de pestañas y capturas de Chrome DevTools Protocol en modo de solo lectura, sin iniciar ni navegar el navegador. |
| Code Research | [`extensions/code-research/README.md`](extensions/code-research/README.md) | Búsqueda de símbolos, referencias, call trees y reverse call trees para TypeScript, JavaScript y Java usando Tree-sitter, más indexado Python en el workspace graph. |
| Context7 | [`extensions/context7/README.md`](extensions/context7/README.md) | Herramientas seguras y acotadas para documentación de librerías con Context7, sin MCP. |
| PDF Review | [`extensions/pdf-review/README.md`](extensions/pdf-review/README.md) | Extracción local de PDF con OCR opcional vía OCRmyPDF/Tesseract. |
| Permission Guard | [`extensions/permission-guard/README.md`](extensions/permission-guard/README.md) | Política de permisos in-process para herramientas soportadas y comandos bash del usuario. |
| Sidebar | [`extensions/sidebar/README.md`](extensions/sidebar/README.md) | Sidebar tipo HUD con chat, subagentes, todo y estado de git. |
| Skill Registry | [`extensions/skill-registry/README.md`](extensions/skill-registry/README.md) | Generador de índice de routing para skills globales y de proyecto. Opt-in vía `.pi/skill-registry.config.json` con `enabled: true`; sin variables de entorno dedicadas. |
| Utils | [`extensions/utils/README.md`](extensions/utils/README.md) | Utilidades generales; actualmente conversión de Markdown a audio con Piper/eSpeak local, voces Piper, MP3, bitrate y progreso en status bar. |
| Websearch | [`extensions/websearch/README.md`](extensions/websearch/README.md) | Búsqueda web, comunidades, GitHub e investigación con salida acotada y routers públicos agrupados. Config opcional global: `~/.pi/agent/websearch.json`; credenciales solo por entorno. |
| Workspace Services | [`extensions/workspace-services/README.md`](extensions/workspace-services/README.md) | Gestión de servicios de workspace configurados manualmente, incluyendo ciclo de vida, estado y logs locales acotados. |
| YouTube Research | [`extensions/youtube-research/README.md`](extensions/youtube-research/README.md) | Búsqueda de YouTube, metadata, transcripciones, canales y playlists usando `yt-dlp`. |

#### Referencia rápida de extensiones

| Extensión | Herramientas/capacidades principales | Descripción breve | Más información |
|---|---|---|---|
| Agent Todo | `agent_todo` | Mantiene una checklist activa para la rama de conversación actual; útil en trabajos de implementación o validación con varios pasos. | [Ver más](extensions/agent-todo/README.md) |
| API Tools | Herramientas REST/GraphQL del proyecto | Expone llamadas API locales definidas en `.pi/api.json`, con login/token, respuestas acotadas y diagnósticos seguros. | [Ver más](extensions/api-tools/README.md) |
| Browser Screenshot | `browser_cdp_status`, `browser_tabs_list`, `browser_page_screenshot` | Inspecciona pestañas Chrome CDP existentes y obtiene capturas sin navegar ni cambiar el foco. | [Ver más](extensions/browser-screenshot/README.md) |
| Code Research | `find_symbol`, `find_references`, `function_call_tree`, `reverse_function_call_tree`, `workspace_graph_status` | Aporta inteligencia de código para TypeScript, JavaScript y Java, con indexado de archivos/símbolos Python en el workspace graph. | [Ver más](extensions/code-research/README.md) |
| Context7 | `context7_search_library`, `context7_get_context`, `context7_resolve_and_get_context` | Obtiene documentación enfocada de librerías con Context7, salida acotada y configuración segura. | [Ver más](extensions/context7/README.md) |
| PDF Review | `pdf_extract` | Extrae texto y metadata de PDFs locales, con OCR opcional mediante OCRmyPDF/Tesseract. | [Ver más](extensions/pdf-review/README.md) |
| Permission Guard | Políticas para tools y bash | Aplica reglas de seguridad in-process para tools soportadas, comandos bash, rutas protegidas, aprobaciones y secretos. | [Ver más](extensions/permission-guard/README.md) |
| Sidebar | Sidebar/HUD de TUI | Agrega una vista lateral para chat, subagentes, estado de todo y estado de git. | [Ver más](extensions/sidebar/README.md) |
| Skill Registry | `skill_registry_generate`, `skill_registry_resolve` | Construye y consulta el índice de routing para skills globales y de proyecto. | [Ver más](extensions/skill-registry/README.md) |
| Utils | `markdown_to_audio` | Convierte Markdown a audio local con Piper o eSpeak NG, control de bitrate MP3 y progreso compacto en status bar. | [Ver más](extensions/utils/README.md) |
| Websearch | `web_search`, herramientas de discusión, investigación y GitHub | Provee búsquedas acotadas en web, comunidades, GitHub y fuentes académicas/de investigación. | [Ver más](extensions/websearch/README.md) |
| Workspace Services | `workspace_services_*`, `workspace_service_*` | Gestiona solo los servicios declarados en `.pi/workspace-services.json`, con estado local de procesos y logs acotados. | [Ver más](extensions/workspace-services/README.md) |
| YouTube Research | Herramientas de búsqueda, video, transcripción, canal y playlist | Busca e inspecciona videos, transcripciones, canales y playlists de YouTube mediante herramientas basadas en `yt-dlp`. | [Ver más](extensions/youtube-research/README.md) |

Después de cambiar código de extensiones, subagentes Markdown, skills o configuración durante una sesión interactiva de Pi, ejecuta `/reload` o reinicia Pi cuando el README/skill correspondiente lo indique.

Nota: Skill Registry permanece deshabilitado hasta que un proyecto lo active explícitamente mediante `.pi/skill-registry.config.json`.

### Comandos de validación

Valida el instalador y el actualizador sin modificar el directorio de agente real:

```bash
bash tests/install_test.sh
bash tests/update_test.sh
```

Ejecuta la validación de cada extensión desde su directorio según sea necesario:

```bash
cd extensions/<nombre-de-extensión>
npm test
npm run typecheck
```

Ejemplos:

```bash
cd extensions/browser-screenshot
npm test
npm run typecheck
```

```bash
cd extensions/utils
npm test
npm run typecheck
```

```bash
cd extensions/workspace-services
npm test
npm run typecheck
```

Notas runtime:

- Code Research usa dependencias de parser Tree-sitter instaladas con la extensión.
- YouTube Research requiere `yt-dlp` en `PATH`.
- PDF Review en modo OCR requiere OCRmyPDF/Tesseract solo cuando se solicita OCR.
- Utils Markdown-to-audio requiere un motor TTS local: `piper-tts`/`piper` con al menos una voz Piper `.onnx`, o fallback `espeak-ng`. `ffmpeg` solo es necesario para salida MP3.

### Notas de seguridad

- No guardes secretos en skills, README, memorias, `.pi/*.json` o configuración de extensiones.
- Las llamadas live de Context7 requieren `CONTEXT7_API_KEY` en el entorno del proceso Pi, no en archivos del repositorio.
- Skill Registry no tiene variables de entorno dedicadas; el opt-in por proyecto se controla con `.pi/skill-registry.config.json` y `enabled: true`.
- Credenciales de Websearch como `EXA_API_KEY`, `PARALLEL_API_KEY`, `GITHUB_TOKEN`, `STACK_EXCHANGE_KEY`, `OPENALEX_MAILTO`, `CROSSREF_MAILTO` y `SEMANTIC_SCHOLAR_API_KEY` deben vivir en el entorno del proceso, no en archivos del repositorio.
- Permission Guard es una protección in-process, no un sandbox de sistema operativo.
- Configuraciones de emergencia como `bypassAll` deshabilitan el comportamiento normal del guard; inspecciona la configuración activa antes de validar enforcement.

### Subagentes

La extensión Subagents se mantiene como el paquete independiente [`pi-subagents-j0k3r`](https://github.com/j0k3r-dev-rgl/pi-subagents-j0k3r). El instalador instala o actualiza ese paquete, mientras este repositorio conserva las definiciones Markdown globales/de usuario y la configuración relacionada.

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
