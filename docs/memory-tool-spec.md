# Especificación: Tool de Memoria para Pi

## 1. Objetivo

Definir una herramienta de memoria persistente y portable para agentes en Pi, usando SQLite + FTS5 como backend inicial.

La memoria debe ser local-first: debe funcionar sin red, poder moverse entre máquinas, exportarse/importarse y prepararse para sincronización futura sin depender de un proveedor específico.

La memoria debe permitir que el agente:

- Recuerde preferencias generales del usuario.
- Recuerde información compartida o global.
- Recuerde decisiones y contexto del proyecto actual.
- Busque memorias relevantes antes de actuar.
- Guarde aprendizajes útiles al finalizar tareas.
- Evite mezclar contexto entre proyectos no relacionados.
- Exporte e importe el “cerebro” completo de forma reproducible.
- Mantenga compatibilidad mediante versiones de esquema y migraciones.

## 2. Scopes de memoria

Usaremos tres scopes:

1. `general`
2. `project`
3. `global`

### 2.1 `general`

Memoria general del usuario, sin proyecto asociado.

Debe usarse para:

- Preferencias personales del usuario.
- Estilo de comunicación.
- Preferencias de desarrollo.
- Reglas personales recurrentes.
- Información útil cuando no hay proyecto activo.

Ejemplos:

```txt
El usuario prefiere respuestas concisas en español.
El usuario prefiere TDD para cambios grandes.
El usuario prefiere TypeScript para prototipos rápidos.
```

Regla:

- `scope = general`
- `project_id = NULL`
- `project_name = NULL`

### 2.2 `project`

Memoria específica del proyecto actual.

Debe usarse para:

- Decisiones técnicas del proyecto.
- Arquitectura local.
- Comandos de build/test/lint.
- Convenciones del repo.
- Bugs conocidos.
- Estado de features.
- Restricciones del proyecto.

Ejemplos:

```txt
Este proyecto usa Pi extensions en .pi/extensions.
Los documentos de producto viven en docs/.
La memoria se diseñó con SQLite + FTS5 para el MVP.
```

Regla:

- `scope = project`
- `project_id` obligatorio
- `project_name` obligatorio

### 2.3 `global`

Memoria global compartida o transversal.

Debe usarse para reglas o conocimiento que aplica a todos los proyectos y, potencialmente, a todo el equipo.

Ejemplos:

```txt
Nunca guardar secretos en memoria.
El equipo prefiere Conventional Commits.
Las tareas grandes deben pasar por SDD/TDD.
```

Regla:

- `scope = global`
- `project_id = NULL`
- `project_name = NULL`

Diferencia entre `general` y `global`:

- `general`: preferencias personales del usuario.
- `global`: reglas compartidas, de sistema o equipo.

## 3. Archivo de configuración del proyecto

La herramienta debe buscar un archivo opcional:

```txt
.pi/memory.json
```

### 3.1 Formato inicial

Por ahora solo tendrá:

```json
{
  "project_name": "j0k3r-pi"
}
```

`project_name` será el nombre canónico con el que se guardará y filtrará la memoria de proyecto.

### 3.2 Reglas

- Si existe `.pi/memory.json` y contiene `project_name`, usar ese valor.
- El archivo debe ser simple y editable a mano.
- Si el archivo es inválido, la tool debe avisar y usar fallback automático.
- En el futuro se podrán agregar más campos sin romper compatibilidad.

Formato futuro posible:

```json
{
  "project_name": "j0k3r-pi",
  "aliases": ["pi-agent-workflow"],
  "default_scope": "project",
  "session_end": {
    "semantic": false
  },
  "cloud": {
    "enabled": false,
    "organization_id": "org_abc123",
    "actor_id": "actor_j0k3r",
    "remote_project_id": "proj_j0k3r_pi",
    "url_env": "PI_MEMORY_CLOUD_URL",
    "token_env": "PI_MEMORY_CLOUD_TOKEN"
  }
}
```

### 3.3 Configuración de cierre de sesión

La sección `session_end` controla el trabajo automático al salir.

Reglas:

- `session_end.semantic = false` es el default: el cierre usa resumen heurístico local y no llama al modelo, aunque haya un modelo activo.
- `session_end.semantic = true` habilita resumen semántico y actualización semántica del `project_profile` durante `session_shutdown`.
- Si el modo semántico está habilitado y el modelo/auth falla, debe caer a resumen/update heurístico sin bloquear la memoria local.
- El objetivo del default es que salir de Pi sea rápido y predecible.

### 3.4 Configuración cloud opcional

La sección `cloud` prepara el proyecto para sincronización futura, pero no cambia el comportamiento local del MVP.

Reglas:

- `cloud.enabled = false` significa que la memoria funciona solo local y no intenta sincronizar.
- `cloud.enabled = true` habilita sincronización cloud para el proyecto actual.
- La búsqueda y recuperación de memoria siguen consultando SQLite local; cloud no se usa para búsqueda en esta etapa.
- `organization_id`, `actor_id` y `remote_project_id` solo son necesarios cuando `cloud.enabled = true`.
- `url_env` indica el nombre de la variable de entorno que contiene la URL del servicio cloud.
- `token_env` indica el nombre de la variable de entorno que contiene el token.
- Si `url_env` no existe, usar `PI_MEMORY_CLOUD_URL` por defecto.
- Si `token_env` no existe, usar `PI_MEMORY_CLOUD_TOKEN` por defecto.
- No guardar tokens directamente en `.pi/memory.json`.
- Si `cloud.enabled = true` pero faltan URL o token en variables de entorno, la sync debe fallar con un error claro sin afectar la memoria local.


## 4. Almacenamiento portable

El archivo `.pi/memory.json` identifica el proyecto, pero no debería ser la base de datos principal.

### 4.1 Ubicación recomendada

Por defecto, usar una base local del usuario:

```txt
$XDG_DATA_HOME/pi/memory/memory.sqlite
```

Fallback si `XDG_DATA_HOME` no existe:

```txt
~/.local/share/pi/memory/memory.sqlite
```

Variables opcionales:

```txt
PI_MEMORY_DB_PATH=/ruta/a/memory.sqlite
PI_MEMORY_HOME=/ruta/a/directorio-memory
```

Reglas:

- La base debe poder copiarse a otra máquina junto con sus exports.
- No guardar la base dentro del repo por defecto para evitar commits accidentales.
- Permitir modo portable explícito apuntando `PI_MEMORY_DB_PATH` a un disco/carpeta sincronizada.
- Crear directorios automáticamente con permisos restrictivos cuando sea posible (`0700` para directorios, `0600` para DB/exports).

### 4.2 Inicialización SQLite

Al abrir la DB:

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
```

Notas:

- `foreign_keys = ON` es obligatorio para que funcionen `ON DELETE CASCADE` y referencias.
- WAL mejora concurrencia local; los exports son preferibles para portabilidad entre sistemas.

### 4.3 Versionado y migraciones

Agregar tabla de metadatos:

```sql
CREATE TABLE memory_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

Claves mínimas:

```txt
schema_version
brain_id
created_at
updated_at
```

Reglas:

- `schema_version` controla migraciones incrementales.
- `brain_id` identifica este cerebro portable aunque cambie de máquina.
- Toda migración debe ser idempotente o registrarse en `memory_meta`.

## 5. Resolución automática de contexto

La tool debe resolver automáticamente el contexto antes de guardar o buscar memoria.

### 5.1 Algoritmo recomendado

Entrada:

- `cwd`: directorio actual de Pi.
- `HOME`: home del usuario.

Pasos:

1. Si `cwd` es exactamente `HOME`, usar `scope = general`.
2. Si existe `.pi/memory.json` en `cwd` o en la raíz detectada del proyecto y contiene `project_name`, usar `scope = project` con ese `project_name`.
3. Si hay repositorio git:
   - Buscar raíz con `git rev-parse --show-toplevel`.
   - Si existe remote, usar el nombre del repo remoto.
   - Si no existe remote, usar el nombre de la carpeta raíz del repo.
4. Si no hay git:
   - Si la carpeta actual es `HOME`, usar `general`.
   - Si no, usar `scope = project` con el nombre de la carpeta actual.

### 5.2 Ejemplos

#### Caso A: existe `.pi/memory.json`

```json
{
  "project_name": "my-product-api"
}
```

Resultado:

```json
{
  "scope": "project",
  "project_name": "my-product-api",
  "project_id": "project:my-product-api"
}
```

#### Caso B: repo git con remote

Remote:

```txt
git@github.com:j0k3r/j0k3r-pi.git
```

Resultado:

```json
{
  "scope": "project",
  "project_name": "j0k3r-pi",
  "project_id": "git:github.com/j0k3r/j0k3r-pi"
}
```

#### Caso C: repo git sin remote

Ruta:

```txt
/home/j0k3r/dev/my-local-project
```

Resultado:

```json
{
  "scope": "project",
  "project_name": "my-local-project",
  "project_id": "project:my-local-project"
}
```

#### Caso D: sin git, fuera de home

Ruta:

```txt
/home/j0k3r/scripts
```

Resultado:

```json
{
  "scope": "project",
  "project_name": "scripts",
  "project_id": "project:scripts"
}
```

#### Caso E: en home

Ruta:

```txt
/home/j0k3r
```

Resultado:

```json
{
  "scope": "general",
  "project_name": null,
  "project_id": null
}
```

## 6. Identificación de proyecto

Para mantener simplicidad:

- `project_name` será el nombre visible y canónico.
- `project_id` será un identificador estable derivado cuando sea posible.

Reglas:

1. Si viene de `.pi/memory.json`, usar `project_name` y derivar `project_id = project:<slug(project_name)>`.
2. Si viene de git remote, usar `project_id = git:<host>/<owner>/<repo>`.
3. Si viene de carpeta, usar `project_id = project:<slug(folder_name)>`.

Nota: si en el futuro hay colisiones de nombres, podremos agregar hash de ruta o aliases.

### 6.1 Aliases de proyecto

Para que el cerebro sea portable entre máquinas, un mismo proyecto puede tener rutas o remotes distintos.

Tabla futura recomendada:

```sql
CREATE TABLE memory_project_aliases (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  alias_type TEXT NOT NULL CHECK (alias_type IN ('path', 'git_remote', 'project_name', 'manual')),
  alias_value TEXT NOT NULL,
  created_at TEXT NOT NULL,
  metadata_json TEXT
);
```

Uso:

- Mapear `/home/user/dev/app` y `/Users/user/src/app` al mismo `project_id`.
- Registrar remotes equivalentes (`ssh` vs `https`).
- Evitar duplicar memorias al mover el proyecto de máquina.

## 7. Regla de filtrado para agentes

Por defecto, la búsqueda debe priorizar el contexto actual.

### 7.1 Si el agente está dentro de un proyecto

Debe consultar:

1. Memorias `global`.
2. Memorias `general`.
3. Memorias `project` únicamente del proyecto actual.
4. Resúmenes de sesiones del proyecto actual.
5. Decisiones y aprendizajes del proyecto actual.

Debe excluir:

- Memorias de otros proyectos.
- Sesiones de otros proyectos.
- Memorias desactivadas.
- Memorias con baja confianza, salvo que se pida explícitamente.
- Memorias marcadas como sensibles o privadas si el contexto no lo permite.

Política recomendada:

```txt
memory_search(query, scopes = ["global", "general", "project"], project_id = current_project_id)
```

### 7.2 Si el agente está en `$HOME`

Si `cwd` es exactamente `$HOME`, no hay proyecto activo. En ese caso la búsqueda puede usar todo el conocimiento disponible.

Debe consultar:

1. Memorias `global`.
2. Memorias `general`.
3. Memorias `project` de todos los proyectos.
4. Resúmenes de sesiones de todos los proyectos.

Política recomendada:

```txt
memory_search(query, scopes = ["global", "general", "project"], project_mode = "all")
```

Este modo debe mostrar claramente de qué proyecto proviene cada resultado para evitar confusión.

### 7.3 Resultado esperado

El resultado debería combinar:

- Reglas globales relevantes.
- Preferencias generales del usuario.
- Contexto del proyecto actual, si existe.
- Resúmenes de sesiones relevantes.
- Aprendizajes o decisiones arquitectónicas relevantes.

Ejemplo:

Solicitud del usuario:

```txt
Agrega tests para este módulo.
```

El agente debería buscar:

```txt
memory_search("testing tests convenciones comandos proyecto preferencias usuario")
```

Y recuperar:

- Global: "Las tareas grandes deben pasar por SDD/TDD".
- General: "El usuario prefiere TDD para cambios grandes".
- Project: "Los tests se ejecutan con npm test".

## 8. Tipos de memoria

Campo `kind` recomendado:

- `preference`
- `decision`
- `architecture`
- `architectural_decision`
- `command`
- `constraint`
- `workflow`
- `note`
- `learning`
- `session_summary`
- `prompt`
- `bug`
- `todo`
- `progress`
- `api`
- `dependency`
- `project_profile`

Reglas especiales:

- Usar `architectural_decision` cuando se tome una decisión técnica relevante para el proyecto.
- Usar `learning` cuando el agente aprenda algo reutilizable durante una tarea.
- Usar `session_summary` para guardar lo hecho y aprendido en una sesión de chat.
- Usar `prompt` para registrar prompts relevantes usados durante una sesión.

## 9. Esquema SQLite propuesto

### 9.1 Tabla principal de memorias

Tabla principal:

```sql
CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  device_id TEXT,
  scope TEXT NOT NULL CHECK (scope IN ('general', 'project', 'global')),
  project_id TEXT,
  project_name TEXT,
  kind TEXT NOT NULL,
  title TEXT,
  summary TEXT,
  content TEXT NOT NULL,
  tags TEXT,
  source TEXT NOT NULL DEFAULT 'agent',
  origin_type TEXT DEFAULT 'inferred_by_agent',
  confidence REAL NOT NULL DEFAULT 1.0,
  importance INTEGER NOT NULL DEFAULT 3,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived', 'superseded')),
  version INTEGER NOT NULL DEFAULT 1,
  sync_status TEXT NOT NULL DEFAULT 'local' CHECK (sync_status IN ('local', 'pending', 'synced', 'conflict')),
  cloud_sync_id TEXT,
  cloud_synced_at TEXT,
  cloud_revision TEXT,
  content_hash TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_accessed_at TEXT,
  access_count INTEGER NOT NULL DEFAULT 0,
  metadata_json TEXT,
  CHECK (
    (scope IN ('general', 'global') AND project_id IS NULL AND project_name IS NULL) OR
    (scope = 'project' AND project_id IS NOT NULL AND project_name IS NOT NULL)
  )
);
```

Notas de serialización:

- `tags` se guarda como JSON string (`["tag"]`) o texto normalizado separado por espacios; elegir una convención única en la implementación.
- `metadata_json` debe ser JSON válido cuando no sea `NULL`.
- `created_at`, `updated_at` y timestamps deben guardarse en ISO-8601 UTC.

Índices:

```sql
CREATE INDEX idx_memories_scope ON memories(scope);
CREATE INDEX idx_memories_project_id ON memories(project_id);
CREATE INDEX idx_memories_project_name ON memories(project_name);
CREATE INDEX idx_memories_kind ON memories(kind);
CREATE INDEX idx_memories_status ON memories(status);
CREATE INDEX idx_memories_importance ON memories(importance);
CREATE INDEX idx_memories_user_id ON memories(user_id);
CREATE INDEX idx_memories_sync_status ON memories(sync_status);
CREATE INDEX idx_memories_cloud_sync_id ON memories(cloud_sync_id);
CREATE INDEX idx_memories_content_hash ON memories(content_hash);
CREATE INDEX idx_memories_updated_at ON memories(updated_at);
```

### 9.1.1 Generación de IDs

Los IDs deben ser autogenerados por la tool, no por el agente.

Objetivos:

- Ser únicos globalmente.
- Ser estables para sincronización futura.
- Permitir depuración humana.
- Evitar colisiones entre usuarios, dispositivos y proyectos.

Formato recomendado:

```txt
mem_<user_slug>_<scope_or_project_slug>_<time_ms>_<uuid7-or-random>
```

Ejemplos:

```txt
mem_j0k3r_j0k3r-pi_1779878400000_018fc8f2a1b7c9d0
mem_j0k3r_general_1779878400000_018fc8f2a1b7c9d1
mem_j0k3r_global_1779878400000_018fc8f2a1b7c9d2
```

Componentes:

- `user_slug`: nombre de usuario normalizado.
- `scope_or_project_slug`:
  - `general` para scope general.
  - `global` para scope global.
  - slug del `project_name` para scope project.
- `time_ms`: timestamp en milisegundos.
- `uuid7-or-random`: UUIDv7 preferido; si no está disponible, random UUID.

Reglas:

- El agente nunca envía `id` al crear memoria.
- La tool devuelve el `id` creado.
- Para sincronización, el `id` no debe cambiar nunca.
- Si se sincroniza entre dispositivos, `device_id` ayuda a resolver conflictos.
- `updated_at`, `version` y `sync_status` se usarán para sincronización incremental.


### 9.2 Sesiones

Además de memorias sueltas, se guardarán sesiones de chat.

Una sesión representa una conversación o flujo de trabajo realizado con Pi.

```sql
CREATE TABLE memory_sessions (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('general', 'project', 'global')),
  project_id TEXT,
  project_name TEXT,
  title TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  summary TEXT,
  learned TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived', 'superseded')),
  metadata_json TEXT,
  CHECK (
    (scope IN ('general', 'global') AND project_id IS NULL AND project_name IS NULL) OR
    (scope = 'project' AND project_id IS NOT NULL AND project_name IS NOT NULL)
  )
);
```

Campos clave:

- `summary`: qué se hizo durante la sesión.
- `learned`: qué se aprendió y podría ser útil en el futuro.
- `metadata_json`: puede guardar el id/path de sesión de Pi, modelo usado, coste, duración, etc.

Índices:

```sql
CREATE INDEX idx_memory_sessions_scope ON memory_sessions(scope);
CREATE INDEX idx_memory_sessions_project_id ON memory_sessions(project_id);
CREATE INDEX idx_memory_sessions_started_at ON memory_sessions(started_at);
CREATE INDEX idx_memory_sessions_status ON memory_sessions(status);
```

### 9.3 Prompts usados en sesiones

Se guardarán los prompts relevantes usados durante una sesión.

```sql
CREATE TABLE memory_session_prompts (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES memory_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool', 'extension')),
  prompt TEXT NOT NULL,
  prompt_index INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  metadata_json TEXT
);
```

Índices:

```sql
CREATE INDEX idx_memory_session_prompts_session_id ON memory_session_prompts(session_id);
CREATE INDEX idx_memory_session_prompts_role ON memory_session_prompts(role);
```

### 9.4 FTS5

FTS5:

```sql
CREATE VIRTUAL TABLE memories_fts USING fts5(
  title,
  summary,
  content,
  tags,
  kind,
  project_name,
  content='memories',
  content_rowid='rowid'
);

CREATE VIRTUAL TABLE memory_sessions_fts USING fts5(
  title,
  summary,
  learned,
  project_name,
  content='memory_sessions',
  content_rowid='rowid'
);

CREATE VIRTUAL TABLE memory_session_prompts_fts USING fts5(
  prompt,
  role,
  content='memory_session_prompts',
  content_rowid='rowid'
);
```

Triggers:

```sql
CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, title, summary, content, tags, kind, project_name)
  VALUES (new.rowid, new.title, new.summary, new.content, new.tags, new.kind, new.project_name);
END;

CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, title, summary, content, tags, kind, project_name)
  VALUES('delete', old.rowid, old.title, old.summary, old.content, old.tags, old.kind, old.project_name);
END;

CREATE TRIGGER memories_au AFTER UPDATE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, title, summary, content, tags, kind, project_name)
  VALUES('delete', old.rowid, old.title, old.summary, old.content, old.tags, old.kind, old.project_name);

  INSERT INTO memories_fts(rowid, title, summary, content, tags, kind, project_name)
  VALUES (new.rowid, new.title, new.summary, new.content, new.tags, new.kind, new.project_name);
END;
```

También deberán existir triggers equivalentes para:

- `memory_sessions_fts`
- `memory_session_prompts_fts`

## 10. Tools propuestas para Pi

### 10.1 `memory_context`

Devuelve el contexto resuelto automáticamente.

Parámetros:

```json
{}
```

Respuesta ejemplo:

```json
{
  "scope": "project",
  "project_name": "j0k3r-pi",
  "project_id": "project:j0k3r-pi",
  "source": ".pi/memory.json"
}
```

### 10.2 `memory_start_chat`

Tool de inicio de chat. Debe ejecutarse al comenzar una nueva sesión o antes de la primera tarea importante.

Objetivo:

- Resolver el contexto actual.
- Crear o registrar la sesión de memoria.
- Recuperar el contexto mínimo útil para que el agente sepa dónde está parado.
- Mostrar qué se hizo recientemente y qué decisiones siguen vigentes.

Parámetros:

```json
{
  "user_prompt": "prompt inicial del usuario opcional",
  "session_title": "título opcional",
  "limit_recent_sessions": 5,
  "limit_memories": 12,
  "include_prompts": false
}
```

Debe consultar y devolver:

1. `memory_context`: scope, project_name, project_id y fuente de resolución.
2. Reglas `global` activas importantes.
3. Preferencias `general` relevantes del usuario.
4. Si hay proyecto:
   - perfil/resumen vivo del proyecto (`project_profile`).
   - decisiones arquitectónicas vigentes.
   - comandos conocidos del proyecto.
   - restricciones y convenciones.
   - aprendizajes recientes.
   - todos/follow-ups activos.
   - últimos resúmenes de sesiones del proyecto.
5. Si está en `$HOME`:
   - resumen general.
   - últimas sesiones de todos los proyectos.
   - proyectos tocados recientemente.
6. Crear una fila en `memory_sessions` y devolver `session_id`.

Respuesta ejemplo:

```json
{
  "session_id": "session_123",
  "context": {
    "scope": "project",
    "project_name": "j0k3r-pi",
    "project_id": "project:j0k3r-pi"
  },
  "startup_context": {
    "global_rules": [],
    "general_preferences": [],
    "project_profile": null,
    "active_decisions": [],
    "known_commands": [],
    "recent_learnings": [],
    "open_todos": [],
    "recent_sessions": []
  }
}
```

Reglas:

- Debe ser compacta: devolver contexto útil, no todo el historial.
- Debe incluir IDs para que el agente pueda consultar detalles si hace falta.
- No debe incluir prompts completos salvo `include_prompts = true`.
- Debe mostrar claramente el proyecto origen cuando esté en modo `$HOME`.

### 10.3 `memory_add`

Guarda una memoria.

Parámetros:

```json
{
  "scope": "general | project | global",
  "kind": "preference | decision | architecture | architectural_decision | command | constraint | workflow | note | learning | session_summary | prompt | bug | todo | progress | api | dependency | project_profile",
  "title": "título corto opcional",
  "summary": "resumen corto opcional",
  "content": "texto completo de la memoria",
  "tags": ["tag1", "tag2"],
  "origin_type": "explicit_user | inferred_by_agent | confirmed_by_user | observed_from_code | session_summary",
  "confidence": 1.0,
  "importance": 3
}
```

Reglas:

- El agente solo puede elegir `scope`, nunca `project_id` ni `project_name`.
- `project_id` y `project_name` son siempre autodetectados por la tool.
- No guardar secretos.
- No guardar información temporal de bajo valor.
- Si no se indica `scope`, usar el scope del contexto automático.
- Para `general` y `global`, la tool debe guardar `project_id = NULL` y `project_name = NULL`.
- Para `project`, la tool debe resolver automáticamente el proyecto actual usando `.pi/memory.json`, git o carpeta.
- Si `scope = project` pero el contexto resuelto es `$HOME`, la tool debe rechazar la operación o degradar a `general` con aviso explícito.
- Si no se proporciona `title`, la tool puede generar uno corto a partir del contenido.
- Si no se proporciona `summary`, la tool puede generar un resumen compacto.
- La tool genera automáticamente `id`, `user_id`, `device_id`, `created_at`, `updated_at`, `version` y `sync_status`.

### 10.4 `memory_search`

Busca memorias relevantes.

Importante: `memory_search` debe devolver resultados compactos, no memorias completas largas. Su objetivo es descubrir candidatos. Para leer una memoria completa se debe usar `memory_get` por id.

Parámetros:

```json
{
  "query": "texto de búsqueda",
  "scopes": ["global", "general", "project"],
  "project_mode": "current | all | selected",
  "project_name": "opcional; solo permitido para consulta cuando project_mode = selected",
  "kinds": ["preference", "decision"],
  "include_sessions": true,
  "include_prompts": false,
  "limit": 10,
  "min_importance": 1,
  "compact": true
}
```

Reglas por defecto:

- Si hay proyecto, usar `project_mode = current`.
- Si `cwd` es `$HOME`, usar `project_mode = all`.
- Si no se indica `scopes`, usar `["global", "general", "project"]`.
- Para guardar memoria, el agente no puede elegir proyecto; para consultar sí puede elegir proyecto con `project_mode = selected` y `project_name`.
- Si `project_mode = current`, filtrar `project` por el proyecto actual autodetectado.
- Si `project_mode = all`, permitir resultados de todos los proyectos.
- Si `project_mode = selected`, filtrar por `project_name` indicado.
- Incluir resúmenes de sesiones por defecto (`include_sessions = true`).
- No incluir prompts completos por defecto (`include_prompts = false`) para evitar ruido.
- Por defecto, incluir solo `status = active`.
- Ordenar por ranking FTS5 + importancia + recencia.
- Devolver snippets, metadatos e IDs; no devolver contenido completo salvo que sea corto.

Respuesta compacta recomendada:

```json
{
  "results": [
    {
      "id": "mem_123",
      "type": "memory",
      "scope": "project",
      "project_name": "j0k3r-pi",
      "kind": "architectural_decision",
      "title": "SQLite + FTS5 para memoria MVP",
      "snippet": "Se decidió usar SQLite + FTS5 para el MVP...",
      "score": 0.87,
      "importance": 4,
      "confidence": 1.0,
      "updated_at": "2026-05-27T00:00:00Z"
    }
  ]
}
```

### 10.5 `memory_get`

Trae una memoria completa por id.

Objetivo:

- Evitar que `memory_search` llene el contexto con memorias completas.
- Permitir un flujo de dos pasos: buscar candidatos y luego cargar solo lo necesario.

Parámetros:

```json
{
  "id": "memory-id",
  "include_links": true,
  "include_evidence": true,
  "include_session": false
}
```

Respuesta recomendada:

```json
{
  "id": "mem_123",
  "scope": "project",
  "project_name": "j0k3r-pi",
  "kind": "architectural_decision",
  "content": "Contenido completo de la memoria...",
  "tags": ["sqlite", "fts5", "memory"],
  "confidence": 1.0,
  "importance": 4,
  "origin_type": "confirmed_by_user",
  "links": [],
  "evidence": [],
  "created_at": "2026-05-27T00:00:00Z",
  "updated_at": "2026-05-27T00:00:00Z"
}
```

Reglas:

- `memory_get` debe actualizar `last_accessed_at` y `access_count`.
- Si la memoria pertenece a otro proyecto, solo permitir si fue descubierta por una búsqueda válida o si el agente está en `$HOME`/modo global de consulta.
- Para contenido muy largo, puede devolver secciones o pedir `include_full_content = true` en una versión futura.

### 10.6 `memory_list`

Lista memorias filtradas de forma compacta.

Parámetros:

```json
{
  "scope": "general | project | global",
  "project_mode": "current | all | selected",
  "project_name": "opcional; solo para consulta cuando project_mode = selected",
  "kind": "opcional",
  "limit": 50
}
```

Reglas:

- Para guardar, el agente no puede elegir proyecto; para consultar/listar sí puede elegir proyecto con `project_mode = selected` y `project_name`.
- Si `scope = project` y `project_mode = current`, la tool usa el proyecto actual autodetectado.
- Si `scope = project` y `project_mode = all`, solo debería permitirse desde `$HOME` o con confirmación explícita.
- Si `scope = project` y `project_mode = selected`, filtrar por `project_name`.
- Debe devolver formato compacto con IDs y snippets; para contenido completo usar `memory_get`.

### 10.7 `memory_update`

Actualiza una memoria existente.

Parámetros:

```json
{
  "id": "memory-id",
  "content": "nuevo contenido opcional",
  "tags": ["tags", "opcionales"],
  "confidence": 0.9,
  "importance": 4,
  "status": "active | archived | superseded"
}
```

### 10.8 `memory_archive`

Archiva una memoria sin eliminarla.

Parámetros:

```json
{
  "id": "memory-id",
  "reason": "motivo opcional"
}
```

Reglas:

- No se eliminan memorias.
- Archivar significa que la memoria deja de aparecer por defecto, pero sigue disponible para auditoría e historial.
- Si una memoria fue reemplazada por otra, usar preferentemente relación `supersedes` y estado `superseded`.

### 10.9 `memory_session_start`

Crea o registra una sesión de memoria.

Parámetros:

```json
{
  "title": "título opcional",
  "scope": "general | project | global",
  "metadata_json": {}
}
```

Reglas:

- El agente solo puede elegir `scope`.
- La tool autodetecta `project_id` y `project_name` si `scope = project`.

### 10.10 `memory_session_prompt_add`

Guarda un prompt usado en una sesión.

Parámetros:

```json
{
  "session_id": "id de la sesión",
  "role": "user | assistant | system | tool | extension",
  "prompt": "texto del prompt",
  "prompt_index": 1,
  "metadata_json": {}
}
```

Regla:

- Guardar prompts de usuario relevantes.
- Evitar guardar tool outputs largos salvo que sean importantes.
- Evitar guardar secretos o contenido sensible.

### 10.11 `memory_session_finish`

Finaliza una sesión y guarda resumen.

Parámetros:

```json
{
  "session_id": "id de la sesión",
  "summary": "qué se hizo",
  "learned": "qué se aprendió",
  "architectural_decisions": ["decisión 1", "decisión 2"],
  "memories_to_add": [
    {
      "kind": "learning",
      "content": "aprendizaje reutilizable",
      "tags": ["tag"]
    }
  ]
}
```

Reglas:

- Guardar `summary` en `memory_sessions.summary`.
- Guardar `learned` en `memory_sessions.learned`.
- Cada decisión arquitectónica relevante debe guardarse también como memoria `kind = architectural_decision`.
- Cada aprendizaje reutilizable debe guardarse también como memoria `kind = learning`.

### 10.12 `memory_recall`

Recupera contexto específico según un momento del flujo.

Parámetros:

```json
{
  "context": "startup | before_task | before_edit | before_test | before_commit | review | session_end",
  "query": "texto opcional para enfocar la búsqueda",
  "limit": 10
}
```

Uso recomendado:

- `startup`: similar a `memory_start_chat`, pero sin crear sesión.
- `before_task`: preferencias, restricciones, decisiones activas y comandos relevantes.
- `before_edit`: arquitectura, convenciones y archivos/módulos relacionados.
- `before_test`: comandos de test, preferencias TDD y convenciones de testing.
- `before_commit`: convenciones de commits, checks y todos activos, solo cuando el usuario pidió explícitamente preparar o realizar un commit. Este contexto no autoriza commits por sí mismo.
- `review`: decisiones, restricciones, bugs conocidos y criterios de calidad.
- `session_end`: guía para resumir, extraer aprendizajes y decisiones.

### 10.13 `memory_export`

Exporta el cerebro completo o una parte a formato portable.

Parámetros:

```json
{
  "path": "ruta opcional del export",
  "format": "jsonl | sqlite"
  "scope": "opcional",
  "project_mode": "current | all | selected",
  "project_name": "opcional",
  "include_prompts": false,
  "include_archived": true
}
```

Reglas:

- No exportar secretos detectados.
- Incluir `schema_version`, `brain_id` y fecha de export.
- `memory_export` es para backup/portabilidad manual, no es el mecanismo principal de sincronización cloud.
- No requiere manifest; el formato debe ser simple y autocontenido.

### 10.14 `memory_import`

Importa memorias desde un export portable.

Parámetros:

```json
{
  "path": "ruta del export",
  "mode": "merge | dry_run",
  "on_conflict": "keep_local | keep_imported | mark_conflict"
}
```

Reglas:

- `dry_run` debe mostrar qué cambiaría sin escribir.
- Por defecto, no sobrescribir silenciosamente; marcar conflictos.
- Recalcular/reconstruir FTS después de importar si hace falta.

## 11. Seguridad, privacidad y redacción

Reglas obligatorias:

- Nunca guardar secretos, tokens, contraseñas, claves privadas ni datos personales sensibles.
- Nunca guardar tokens cloud directamente en memoria ni en exports.
- Antes de guardar, sincronizar o exportar, aplicar detección/redacción básica de secretos.
- Las memorias sensibles deben poder marcarse en `metadata_json`, por ejemplo `{ "sensitive": true }`.
- Los exports deben advertir si contienen prompts completos.
- Considerar cifrado opcional del bundle/export en una versión futura.

## 12. Formato canónico de escritura del cerebro

Para que la memoria funcione como un cerebro local y no como notas sueltas, las memorias deben guardarse con formato consistente, pequeño y recuperable.

### 12.1 Idioma y normalización

Reglas:

- Guardar memorias durables en inglés.
- Usar minúsculas para `title`, `summary`, `content` y `tags`.
- Mantener prompts en su idioma original porque son auditoría.
- Evitar títulos largos o ambiguos.
- Preferir tags cortos, técnicos y estables.

### 12.2 Formato canónico de memoria

Cada memoria durable debería seguir esta estructura conceptual:

```txt
title: short lowercase english title
summary: one-line lowercase english summary
content:
  type: decision | fact | progress | constraint | command | learning | todo | project_profile
  context: why this matters
  details: concrete reusable information
  implications: how future agents should use it
  source: explicit_user | confirmed_by_user | observed_from_code | session_summary
```

No es obligatorio guardar los labels literalmente, pero el contenido debe responder esas ideas.

Ejemplo:

```json
{
  "kind": "decision",
  "title": "startup context only once",
  "summary": "memory startup context is injected once; later turns search memory only when needed.",
  "content": "decision: inject startup brain context only at session start. after startup, do not inject relevant memory automatically on every turn. the agent should call memory_search or memory_recall only for non-trivial tasks that need persistent context. reason: reduce token usage and avoid noisy repeated context.",
  "tags": ["memory", "context", "tokens", "lifecycle"],
  "importance": 5,
  "confidence": 1
}
```

### 12.3 Criterios de buena memoria

Una buena memoria debe ser:

- Durable: útil en futuras sesiones.
- Accionable: ayuda al agente a decidir o actuar.
- Atómica: una idea principal por memoria.
- Recuperable: contiene palabras clave que el agente buscará.
- Vigente: no contradice otra memoria activa.
- No sensible: no contiene secretos ni datos privados innecesarios.

Evitar:

- Guardar conversación literal como memoria durable.
- Guardar estados temporales sin valor futuro.
- Guardar duplicados con distinto wording.
- Mezclar muchas decisiones en una sola memoria.

### 12.4 Formato canónico de session summary

Al cerrar una sesión, el summary debe servir para reabrir el cerebro y entender qué pasó.

Formato recomendado:

```txt
summary:
  what changed:
  decisions made:
  progress:
  validations:
  open todos:

learned:
  reusable learnings:

memory candidates:
  decisions:
  learnings:
  todos:
```

Ejemplo:

```txt
summary:
  what changed: implemented automatic memory startup context and prompt capture.
  decisions made: startup context is injected only once; later turns search only when needed.
  progress: memory extension can create/reuse sessions, capture prompts, and store durable memories.
  validations: npm run typecheck and npm test passed.
  open todos: implement cloud sync and improve generated summaries.

learned:
  reusable learnings: fts5 works better with normalized lowercase token queries joined by or.
```

Reglas:

- El summary debe estar en inglés y minúsculas cuando sea generado por el agente.
- Debe mencionar validaciones ejecutadas.
- Debe listar decisiones importantes.
- Debe listar tareas pendientes si existen.
- Decisiones y aprendizajes importantes deben guardarse también como memorias separadas (`architectural_decision`, `decision`, `learning`, `todo`, `progress`).

## 13. Reglas para guardar memoria automáticamente

El agente puede proponer guardar memoria cuando detecte:

- Una preferencia explícita del usuario.
- Una regla global o de equipo.
- Una decisión técnica importante.
- Una decisión arquitectónica del proyecto.
- Un comando útil del proyecto.
- Una convención recurrente.
- Una restricción que afectará futuras tareas.
- Un aprendizaje confirmado durante una tarea.
- Un resumen útil al finalizar una sesión de chat.
- Prompts relevantes usados durante la sesión.

No debería guardar:

- Datos sensibles.
- Secretos.
- Tokens.
- Contraseñas.
- Información especulativa no confirmada.
- Detalles triviales de una conversación.
- Resultados temporales que no tendrán valor futuro.

## 14. Reglas para consultar memoria automáticamente

El orquestador debería consultar memoria:

### Siempre

- Al iniciar una tarea no trivial.
- Antes de elegir flujo delegado o SDD/TDD.
- Antes de modificar arquitectura.
- Antes de crear tests o ejecutar comandos desconocidos.

### Opcionalmente

- En tareas inline muy pequeñas.

### No necesario

- Correcciones mínimas obvias.
- Preguntas generales sin relación con proyecto o preferencias.

## 15. Relaciones, vigencia y evidencia

Para que la memoria sea útil a agentes, no basta con guardar texto. También necesitamos saber si una memoria sigue vigente, de dónde salió y cómo se relaciona con otras.

### 15.1 Vigencia

Agregar campos futuros o metadata equivalente:

```txt
valid_from
valid_until
is_current
superseded_by
```

Reglas:

- Las memorias reemplazadas no se borran; se marcan como superseded.
- El agente debe preferir memorias vigentes.
- Si una memoria contradice otra, debe mostrar ambas o pedir confirmación.

### 15.2 Relaciones entre memorias

Tabla propuesta:

```sql
CREATE TABLE memory_links (
  id TEXT PRIMARY KEY,
  from_memory_id TEXT NOT NULL REFERENCES memories(id),
  to_memory_id TEXT NOT NULL REFERENCES memories(id),
  relation_type TEXT NOT NULL CHECK (relation_type IN ('supports', 'supersedes', 'contradicts', 'derived_from', 'related_to')),
  created_at TEXT NOT NULL,
  metadata_json TEXT
);
```

Tipos:

- `supports`: una memoria respalda otra.
- `supersedes`: una memoria reemplaza otra.
- `contradicts`: una memoria contradice otra.
- `derived_from`: una memoria viene de otra fuente.
- `related_to`: relación general.

### 15.3 Evidencia y origen

Cada memoria debería poder explicar de dónde salió.

Campos recomendados:

```txt
origin_type: explicit_user | inferred_by_agent | confirmed_by_user | observed_from_code | session_summary
source_ref
quote
```

Reglas:

- `explicit_user` y `confirmed_by_user` tienen mayor confianza.
- `inferred_by_agent` debe tener menor confianza hasta confirmarse.
- Para decisiones arquitectónicas, guardar evidencia o sesión de origen.

## 16. Entidades y memoria operacional

### 16.1 Entidades

Guardar entidades detectadas mejora búsquedas futuras.

Tabla propuesta:

```sql
CREATE TABLE memory_entities (
  id TEXT PRIMARY KEY,
  memory_id TEXT REFERENCES memories(id),
  entity_type TEXT NOT NULL,
  name TEXT NOT NULL,
  value TEXT,
  created_at TEXT NOT NULL
);
```

Tipos sugeridos:

- `package`
- `module`
- `file`
- `command`
- `service`
- `feature`
- `dependency`

### 16.2 Comandos conocidos

Las memorias `kind = command` deben guardar metadata operacional:

```json
{
  "command": "npm test",
  "cwd": ".",
  "last_exit_code": 0,
  "last_verified_at": "2026-05-27T00:00:00Z"
}
```

Esto permite que el agente sepa cómo validar cambios.

## 17. Project profile

Además de sesiones y memorias sueltas, cada proyecto debería tener un resumen vivo llamado `project_profile`.

Puede guardarse como `kind = project_profile` o en una tabla futura dedicada.

Debe contener:

- Stack principal.
- Arquitectura resumida.
- Comandos de build/test/lint.
- Convenciones del repo.
- Decisiones activas.
- Riesgos conocidos.
- Estado actual del trabajo.
- Directorios importantes.

Uso:

- `memory_start_chat` debe consultarlo siempre cuando hay proyecto.
- `memory_session_finish` puede proponer actualizarlo si cambió algo relevante.

## 18. Políticas de confirmación

No todo debe guardarse automáticamente.

Guardar automáticamente:

- Resumen de sesión.
- Comandos verificados.
- Aprendizajes de baja sensibilidad.
- Preferencias explícitas de bajo riesgo.

Pedir confirmación:

- Preferencias globales importantes.
- Decisiones arquitectónicas.
- Cambios en `project_profile`.
- Memorias que contradicen otras existentes.

Nunca guardar:

- Secretos.
- Tokens.
- Passwords.
- Claves privadas.
- Datos personales sensibles.
- Output largo de herramientas sin valor futuro.

## 19. Ranking recomendado

Para el MVP:

```txt
score = bm25_score + importance_boost + recency_boost + confidence_boost + usage_boost
```

Donde:

- `bm25_score`: ranking de FTS5.
- `importance_boost`: memorias importantes suben.
- `recency_boost`: memorias recientes suben ligeramente.
- `confidence_boost`: memorias confirmadas suben.
- `usage_boost`: memorias usadas frecuentemente suben.

Campos útiles:

```txt
access_count
last_accessed_at
```

Más adelante se puede agregar búsqueda semántica con embeddings y ranking híbrido.

## 20. Sincronización futura

Aunque el MVP sea local, el esquema debe estar preparado para sincronización cloud futura controlada por `.pi/memory.json`.

Principio base:

- La memoria siempre se consulta localmente desde SQLite.
- Cloud se usa para sincronizar datos entre usuarios/máquinas del mismo proyecto.
- Cloud no se usa para búsqueda ni ranking en esta etapa.
- La sincronización solo se activa si `cloud.enabled = true`.

Campos base:

- `id`: identificador global estable y canónico de la memoria.
- `user_id`: usuario local propietario/origen.
- `device_id`: dispositivo/origen donde se creó o editó.
- `version`: versión incremental local de la memoria.
- `sync_status`: `local`, `pending`, `synced`, `conflict`.
- `cloud_sync_id`: referencia opcional del registro remoto si cloud necesita una.
- `cloud_synced_at`: última sincronización exitosa.
- `cloud_revision`: revisión/etag/hash remoto para detectar cambios concurrentes.
- `content_hash`: hash del contenido local sincronizable.
- `created_at`, `updated_at`.

Significado de `sync_status`:

- `local`: existe solo localmente o cloud está desactivado.
- `pending`: tiene cambios que deben subirse o aplicarse.
- `synced`: coincide con cloud según `cloud_revision`/`content_hash`.
- `conflict`: hay cambios locales y remotos incompatibles que requieren resolución.

Reglas:

- El `id` local de la memoria es el ID canónico para deduplicación cloud.
- Cloud no debe reemplazar `id`; si necesita ID interno usa `cloud_sync_id`.
- Toda actualización incrementa `version`, actualiza `updated_at`, recalcula `content_hash` y marca `sync_status = pending` si cloud está habilitado.
- No se eliminan memorias: se actualizan, archivan o marcan como `superseded`.
- Si una memoria queda obsoleta, crear/actualizar la memoria nueva y enlazarla con `relation_type = supersedes`.
- Si local y cloud cambiaron la misma memoria desde la última sync, marcar `conflict`; no usar `last write wins` por defecto.
- Las entidades, links, sesiones y prompts también deberían tener IDs globales bajo el mismo formato.
- Las tablas sincronizables deben tener metadata equivalente de sync (`sync_status`, `cloud_sync_id`, `cloud_synced_at`, `cloud_revision`, `content_hash`) o guardarla en `metadata_json` hasta que exista una migración dedicada.

### 20.1 Alcance de cloud sync

Cuando `cloud.enabled = true`, la sync aplica al proyecto actual resuelto por `.pi/memory.json`/git/carpeta.

Debe sincronizar al cloud:

- Memorias `scope = project` del proyecto actual.
- `project_profile`.
- Decisiones, aprendizajes, comandos, bugs, todos, constraints, arquitectura y dependencias del proyecto.
- Links y entidades asociados a memorias del proyecto.
- Sesiones y resúmenes del proyecto.
- Prompts de sesión para auditoría.

No debe sincronizar automáticamente:

- Memorias `general`.
- Memorias `global`.
- Memorias de otros proyectos.

### 20.2 Distribución colaborativa

No todo lo subido al cloud se distribuye a otros usuarios.

Distribuir a otros usuarios/agentes del mismo proyecto:

- Memorias de proyecto.
- `project_profile`.
- Decisiones, aprendizajes, comandos, bugs, todos, constraints, arquitectura y dependencias.
- Links y entidades compartibles.
- Resúmenes de sesión compartibles.

Subir al cloud pero no distribuir al resto de usuarios:

- Prompts completos de sesión.
- Historial privado de interacción.

Regla:

- Los prompts se suben para auditoría/trazabilidad, pero no deben inyectarse en el contexto de otros agentes ni aparecer en búsquedas colaborativas normales.

### 20.3 Comportamiento esperado de sync

Cuando `cloud.enabled = true`:

- Al crear una memoria de proyecto, debe guardarse localmente y luego intentar push cloud.
- Al actualizar o archivar una memoria de proyecto, debe marcarse `pending` y sincronizarse.
- Otros usuarios del mismo proyecto deberían recibir memorias compartibles casi en tiempo real en una etapa futura.
- Si cloud no está disponible, la operación local debe mantenerse y la memoria queda `pending`.

Tools futuras posibles:

- `memory_sync_status`: muestra cambios pendientes/conflictos.
- `memory_resolve_conflict`: resuelve conflictos manualmente.

## 21. Modelo de cerebro del agente

Para que la memoria funcione como un cerebro y no como una papelera de notas, debe comportarse como un sistema de conocimiento vivo.

Principios:

1. No borrar conocimiento.
2. Mantener una vista activa y limpia.
3. Conservar historial para auditoría.
4. Reemplazar conocimiento obsoleto con relaciones explícitas.
5. Distinguir hechos, preferencias, decisiones, aprendizajes y sesiones.

### 21.1 Estados recomendados

- `active`: memoria vigente y utilizable por defecto.
- `archived`: memoria conservada, pero no usada por defecto.
- `superseded`: memoria reemplazada por otra.

### 21.2 Actualización en lugar de eliminación

Cuando algo cambie:

- Si es corrección menor, usar `memory_update` sobre la misma memoria.
- Si es una decisión nueva que reemplaza una anterior, crear nueva memoria y enlazar con `supersedes`.
- Si es información histórica que ya no debe influir, usar `memory_archive`.

### 21.3 Vista activa del cerebro

Las búsquedas normales solo usan:

```txt
status = active
```

Las búsquedas de auditoría o historial pueden incluir:

```txt
status IN ('active', 'archived', 'superseded')
```

### 21.4 Consolidación periódica

El agente debería poder consolidar varias memorias en una mejor memoria.

Tool futura recomendada:

```txt
memory_consolidate
```

Uso:

- Fusionar aprendizajes repetidos.
- Crear un resumen canónico.
- Marcar memorias antiguas como `superseded`.
- Actualizar `project_profile`.

## 22. Búsqueda semántica futura

FTS5 no es semántico. Es full-text search.

Para búsqueda semántica futura:

- Agregar columna `embedding_json` o tabla `memory_embeddings`.
- Generar embeddings al guardar memoria.
- Hacer búsqueda híbrida:
  - FTS5 para coincidencias textuales.
  - Vectores para similitud semántica.
  - Ranking combinado.

Recomendación: no implementar embeddings en el MVP. Diseñar el esquema para permitirlo después.

## 23. Decisión final

- Usar `scope = general` para memoria personal del usuario sin proyecto.
- Usar `scope = project` para memoria del proyecto actual.
- Al guardar, el agente solo puede elegir el `scope`; no puede establecer `project_id` ni `project_name`.
- Al guardar, `project_id` y `project_name` siempre son autodetectados por la tool.
- Al consultar, el agente sí puede elegir proyecto usando `project_mode = selected` y `project_name`.
- Las búsquedas y listados deben devolver resultados compactos con IDs y snippets.
- Para cargar una memoria completa se debe usar `memory_get` por id.
- Usar `scope = global` para reglas compartidas, de sistema o equipo.
- Crear `.pi/memory.json` opcional con `project_name`.
- Si existe `.pi/memory.json`, manda sobre cualquier inferencia automática.
- Si no existe, inferir por git remote, git root o nombre de carpeta.
- Si el directorio actual es `$HOME`, guardar por defecto como `general` y buscar en todo el conocimiento disponible.
- Por defecto, dentro de un proyecto el agente busca en `global + general + project actual`.
- Por defecto, en `$HOME` el agente busca en `global + general + todos los proyectos`.
- Generar IDs únicos con formato basado en usuario + scope/proyecto + tiempo + UUID.
- Preparar el esquema para sincronización futura con `user_id`, `device_id`, `version` y `sync_status`.
- No eliminar memorias: actualizar, archivar o marcar como `superseded`.
- Guardar sesiones de chat.
- Guardar prompts relevantes usados en cada sesión.
- Guardar un `session_summary` con lo hecho y aprendido en cada sesión.
- Definir `memory_start_chat` como tool obligatoria/recomendada al inicio de una sesión.
- `memory_start_chat` debe devolver contexto resuelto, preferencias, reglas, perfil de proyecto, decisiones activas, comandos, aprendizajes, todos y sesiones recientes.
- Si el agente aprende algo reutilizable, guardarlo como `learning`.
- Si hay una decisión arquitectónica del proyecto, guardarla como `architectural_decision`.
- Soportar vigencia, relaciones, superseded y evidencia.
- Mantener un `project_profile` como resumen vivo del proyecto.
- Nunca buscar en otros proyectos desde un proyecto salvo petición explícita o modo `$HOME`.
- SQLite + FTS5 es suficiente para el MVP.
- La DB debe ser local-first y portable mediante ubicación configurable, migraciones, `brain_id`, `memory_export` y `memory_import`.
- Cloud sync futura se configura con `.pi/memory.json -> cloud`, usa variables de entorno para URL/token y no cambia las búsquedas locales.
- El `id` de memoria es canónico para deduplicación cloud; `cloud_sync_id`, `cloud_revision`, `cloud_synced_at` y `content_hash` ayudan a sincronizar actualizaciones.
- Los prompts se pueden subir al cloud para auditoría, pero no se distribuyen al resto de usuarios ni se inyectan en contexto colaborativo normal.
- Activar `PRAGMA foreign_keys`, WAL y `busy_timeout` al abrir SQLite.
- Incluir `project_profile` en los tipos válidos de memoria.
- Mantener embeddings como evolución futura.
