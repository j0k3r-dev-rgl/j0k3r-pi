# Tasks: Extensión de Memoria para Pi

## 1. Objetivo

Implementar la memoria como una extensión de Pi escrita en TypeScript, siguiendo `docs/memory-tool-spec.md`.

La implementación debe ser local-first, usar SQLite + FTS5, exponer custom tools de Pi, guardar sesiones/prompts, resolver contexto automáticamente y quedar preparada para cloud sync futura sin depender de cloud para búsquedas.

## 2. Reglas generales

- Implementar con TDD: primero tests, luego código.
- No usar binarios externos ni Rust.
- La extensión vive en `.pi/extensions/memory/`.
- La búsqueda y lectura de memoria siempre usan SQLite local.
- Cloud por ahora solo queda definido/configurado; no implementar backend real salvo stubs seguros.
- No guardar secretos en memoria.
- No guardar tokens en `.pi/memory.json`; usar variables de entorno.
- El agente puede elegir `scope`, pero no `project_id` ni `project_name` al guardar.
- `project_id` y `project_name` siempre los resuelve la extensión.
- `memory_search` devuelve resultados compactos; contenido completo solo con `memory_get`.
- No borrar memorias: archivar o marcar `superseded`.

## 3. Estructura esperada

```txt
.pi/extensions/memory/
  package.json
  index.ts
  src/
    config.ts
    context.ts
    db.ts
    schema.ts
    migrations.ts
    ids.ts
    types.ts
    memory-store.ts
    search.ts
    sessions.ts
    cloud.ts
    tools.ts
    commands.ts
    lifecycle.ts
    security.ts
    utils.ts
  test/
    config.test.ts
    context.test.ts
    ids.test.ts
    migrations.test.ts
    memory-store.test.ts
    search.test.ts
    sessions.test.ts
    cloud.test.ts
    security.test.ts
```

La estructura puede ajustarse si hay una razón técnica, pero debe mantenerse modular.

## 4. Dependencias esperadas

Pendiente de validar durante implementación:

- `@earendil-works/pi-coding-agent`
- `typebox`
- Preferir `node:sqlite` (`DatabaseSync`) en Node 24+ para evitar dependencias nativas externas; validar FTS5 disponible en `memory-doctor`.
- Si `node:sqlite` no fuese suficiente, elegir una dependencia SQLite compatible con Pi/Node y documentar la razón.
- Test runner: preferentemente `vitest`

## 5. Estado actual implementado

La extensión ya tiene un MVP funcional en `.pi/extensions/memory/` con tests automatizados.

Implementado y validado:

- SQLite local-first con migraciones, FTS5, sesiones, prompts, links y entidades.
- Tools principales: `memory_context`, `memory_add`, `memory_search`, `memory_get`, `memory_list`, `memory_update`, `memory_archive`.
- Tools de sesión: `memory_start_chat`, `memory_session_start`, `memory_session_prompt_add`, `memory_session_finish`, `memory_recall`.
- `memory_recall` acepta aliases `task`, `edit`, `test`, `commit`, `end`.
- Session lifecycle: crea/reusa sesión, captura prompts, inyecta startup context una sola vez, no cierra en reload y cierra con summary estructurado.
- Session summaries: por defecto el cierre usa resumen heurístico local rápido; el intento semántico durante `session_shutdown` es opt-in con `.pi/memory.json -> session_end.semantic=true` y conserva fallback heurístico con metadata `summary_source`, `summary_model`, `summary_generated_at`, `summary_error`.
- Project profile vivo: `memory_project_profile`, `/memory-project-profile`, auto-update al cerrar sesiones; por defecto usa update heurístico conservador. El update semántico del profile durante cierre es opt-in con `session_end.semantic=true`, muestra preview diff y pide confirmación humana opcional para updates grandes en UI, y cae a update heurístico conservador si no hay modelo/auth o falla.
- Migración canónica: `memory_migrate_project` y `/memory-migrate-project [--apply]` migran memorias/sesiones de aliases de carpeta/git/memory.json al proyecto canónico actual, con dry-run por defecto.
- Consolidación: `memory_consolidate` detecta duplicados por título o similitud léxica opcional (`similarity=true`), evita candidatos con riesgo básico de contradicción y, al aplicar, crea memoria consolidada, archiva duplicados y registra links `supersedes`.
- Entidades: al guardar/actualizar memorias se extraen entidades básicas de archivos y comandos en `memory_entities`.
- Export/import JSONL: exporta tablas principales; prompts quedan excluidos salvo `include_prompts=true`; import valida `schema_version`, reporta `conflict_details`, soporta conflictos básicos y reconstruye FTS tras merge.
- Sync status local: `memory_sync_status` y `/memory-sync-status` reportan conteos `local`, `pending`, `conflict`.
- Browser: `/memory-browser` muestra memorias y sesiones con navegación tipo nvim; soporta modo filtro con `:` usando comandos como `query=npm kind=command scope=project status=active project=app` y `c` limpia filtros.
- Skill operativa: `.pi/skills/persistent-memory/SKILL.md` define la política detallada de cuándo consultar/guardar memoria, scopes, profile, consolidación, migración y cierre de sesión. El startup context indica cuándo cargarla.
- Tests separados: `test/memory.test.ts` cubre MVP/store/search/profile/migration; `test/advanced.test.ts` cubre lifecycle fino, summary fallback, startup injection once, reload no-close, consolidación links y entidades.

Validación actual:

```txt
cd .pi/extensions/memory
npm test
npm run typecheck
```

Último estado conocido: 41 tests pasan y typecheck pasa.

Decisión de desarrollo actual: no se mantiene migración legacy para esquemas locales antiguos durante esta fase; ante cambios incompatibles de schema se puede resetear la DB local de desarrollo (`~/.local/share/pi/memory/memory.sqlite*`).

Pendiente relevante:

- Browser UX: acciones rápidas adicionales como archivar desde el browser, copiar id y abrir prompts bajo demanda.
- Project profile semantic auto-update: mejorar calidad del diff visual si hace falta.
- Consolidación: preview más legible y detección de contradicciones más semántica.
- Import: más estrategias de merge y reportes humanos más bonitos.
- Cloud sync real: push/pull, conflictos y política colaborativa.
- Más uso de entities/links en búsqueda y browser.

## 6. Fases y tasks

## Fase 0: Setup de extensión

### T-0.1 Crear estructura base

Estado: pending

Tests primero:
- [ ] Test mínimo que importe el entrypoint de la extensión sin ejecutar Pi real.

Implementación:
- [ ] Crear `.pi/extensions/memory/package.json`.
- [ ] Crear `.pi/extensions/memory/index.ts`.
- [ ] Crear carpetas `src/` y `test/`.
- [ ] Configurar TypeScript/test runner.

Criterios de aceptación:
- [ ] `npm test` corre dentro de `.pi/extensions/memory/`.
- [ ] La extensión exporta función default compatible con Pi.

### T-0.2 Registrar extensión mínima

Estado: pending

Tests primero:
- [ ] Test con mock de `ExtensionAPI` que verifique que se registran tools/comandos mínimos.

Implementación:
- [ ] Registrar comando `memory-status` inicial con `pi.registerCommand("memory-status", ...)` (se invoca como `/memory-status`).
- [ ] Registrar tool `memory_context` inicial con respuesta stub controlada.

Criterios de aceptación:
- [ ] La extensión puede cargarse con `/reload` sin errores.

## Fase 1: Configuración y paths

### T-1.1 Resolver path de DB

Estado: pending

Tests primero:
- [ ] Usa `PI_MEMORY_DB_PATH` si existe.
- [ ] Usa `PI_MEMORY_HOME` si existe.
- [ ] Usa `$XDG_DATA_HOME/pi/memory/memory.sqlite` si existe `XDG_DATA_HOME`.
- [ ] Usa `~/.local/share/pi/memory/memory.sqlite` como fallback.

Implementación:
- [ ] Implementar `config.ts`.
- [ ] Crear directorios con permisos restrictivos cuando aplique.

Criterios de aceptación:
- [ ] Path resuelto coincide con la spec.

### T-1.2 Leer `.pi/memory.json`

Estado: pending

Tests primero:
- [ ] Lee `project_name` válido.
- [ ] Tolera archivo inexistente.
- [ ] Tolera JSON inválido devolviendo warning/fallback.
- [ ] Lee sección `cloud`.
- [ ] Aplica defaults `PI_MEMORY_CLOUD_URL` y `PI_MEMORY_CLOUD_TOKEN`.

Implementación:
- [ ] Implementar lectura desde cwd/proyecto.
- [ ] Validar shape básico.
- [ ] Nunca leer token literal desde JSON.

Criterios de aceptación:
- [ ] Config inválida no rompe memoria local.

## Fase 2: SQLite y migraciones

### T-2.1 Abrir DB con PRAGMAs

Estado: pending

Tests primero:
- [ ] `foreign_keys` queda activo.
- [ ] `busy_timeout` queda configurado.
- [ ] DB se crea si no existe.

Implementación:
- [ ] Implementar `db.ts`.
- [ ] Aplicar `PRAGMA foreign_keys = ON`.
- [ ] Aplicar `PRAGMA journal_mode = WAL`.
- [ ] Aplicar `PRAGMA busy_timeout = 5000`.

Criterios de aceptación:
- [ ] Conexión local usable en tests temporales.

### T-2.2 Crear schema inicial

Estado: pending

Tests primero:
- [ ] Crea `memory_meta`.
- [ ] Crea `memories` con constraints de scope/proyecto.
- [ ] Crea `memory_sessions`.
- [ ] Crea `memory_session_prompts`.
- [ ] Crea `memory_links`.
- [ ] Crea `memory_entities`.
- [ ] Crea FTS5 y triggers de `memories`.

Implementación:
- [ ] Implementar `schema.ts` y `migrations.ts`.
- [ ] Guardar `schema_version`.
- [ ] Generar `brain_id` si no existe.

Criterios de aceptación:
- [ ] Migración es idempotente.

### T-2.3 FTS para sesiones y prompts

Estado: pending

Tests primero:
- [ ] Insert session actualiza `memory_sessions_fts`.
- [ ] Update session actualiza FTS.
- [ ] Delete session elimina FTS.
- [ ] Insert prompt actualiza `memory_session_prompts_fts`.

Implementación:
- [ ] Agregar triggers equivalentes para sesiones.
- [ ] Agregar triggers equivalentes para prompts.

Criterios de aceptación:
- [ ] FTS queda consistente tras insert/update/delete.

## Fase 3: IDs y seguridad

### T-3.1 Generar IDs canónicos

Estado: pending

Tests primero:
- [ ] Genera `mem_<user>_<scope/project>_<time>_<random>`.
- [ ] Slug normaliza usuario/proyecto.
- [ ] IDs distintos en llamadas consecutivas.
- [ ] No permite ID enviado por agente en `memory_add`.

Implementación:
- [ ] Implementar `ids.ts`.

Criterios de aceptación:
- [ ] IDs son estables y aptos para sync futura.

### T-3.2 Redacción básica de secretos

Estado: pending

Tests primero:
- [ ] Detecta tokens comunes.
- [ ] Detecta private keys.
- [ ] Detecta passwords en pares `KEY=value`.
- [ ] Bloquea o redacta antes de guardar según política.

Implementación:
- [ ] Implementar `security.ts`.
- [ ] Aplicar en `memory_add`, prompts y export futuro.

Criterios de aceptación:
- [ ] No se guardan secretos obvios.

## Fase 4: Resolución automática de contexto

### T-4.1 Resolver contexto HOME/general

Estado: pending

Tests primero:
- [ ] Si `cwd === HOME`, scope `general`.
- [ ] `project_id` y `project_name` son null.

Implementación:
- [ ] Implementar `context.ts`.

Criterios de aceptación:
- [ ] Cumple sección 5 de la spec.

### T-4.2 Resolver `.pi/memory.json`

Estado: pending

Tests primero:
- [ ] `.pi/memory.json` manda sobre git/carpeta.
- [ ] `project_id = project:<slug(project_name)>`.

Implementación:
- [ ] Buscar `.pi/memory.json` en cwd o raíz de proyecto detectada.

Criterios de aceptación:
- [ ] Context source indica `.pi/memory.json`.

### T-4.3 Resolver git remote/root/carpeta

Estado: pending

Tests primero:
- [ ] Repo con remote genera `git:<host>/<owner>/<repo>`.
- [ ] Repo sin remote usa nombre de carpeta raíz.
- [ ] Sin git fuera de HOME usa carpeta actual.

Implementación:
- [ ] Usar `git rev-parse --show-toplevel` de forma segura.
- [ ] Parsear remotes SSH/HTTPS.

Criterios de aceptación:
- [ ] No mezcla proyectos.

## Fase 5: Store de memorias

### T-5.1 `memory_add` interno

Estado: pending

Tests primero:
- [ ] Crea memoria general sin proyecto.
- [ ] Crea memoria global sin proyecto.
- [ ] Crea memoria project con proyecto autodetectado.
- [ ] Rechaza/degrada project en HOME con aviso.
- [ ] Genera timestamps/version/sync fields.
- [ ] Si cloud enabled, queda `pending`; si no, `local`.

Implementación:
- [ ] Implementar `memory-store.ts:addMemory`.

Criterios de aceptación:
- [ ] Respeta constraints de scope.

### T-5.2 `memory_get`

Estado: pending

Tests primero:
- [ ] Devuelve contenido completo por id.
- [ ] Actualiza `last_accessed_at`.
- [ ] Incrementa `access_count`.

Implementación:
- [ ] Implementar `getMemory`.

Criterios de aceptación:
- [ ] No devuelve memorias inexistentes como éxito.

### T-5.3 `memory_update` y `memory_archive`

Estado: pending

Tests primero:
- [ ] Update incrementa version.
- [ ] Update recalcula `content_hash`.
- [ ] Update marca `pending` si cloud enabled.
- [ ] Archive cambia status a `archived` sin borrar.

Implementación:
- [ ] Implementar update/archive.

Criterios de aceptación:
- [ ] No hay deletes físicos en flujo normal.

### T-5.4 `memory_list`

Estado: pending

Tests primero:
- [ ] Lista por scope.
- [ ] Filtra proyecto actual.
- [ ] Soporta `project_mode = all` solo según reglas.
- [ ] Devuelve formato compacto.

Implementación:
- [ ] Implementar list.

Criterios de aceptación:
- [ ] No filtra mal memorias de otro proyecto.

## Fase 6: Search local FTS5

### T-6.1 `memory_search`

Estado: pending

Tests primero:
- [ ] Busca por contenido/título/tags.
- [ ] En proyecto busca global + general + project actual.
- [ ] En HOME permite todos los proyectos.
- [ ] Excluye archived/superseded por defecto.
- [ ] Devuelve snippets compactos.

Implementación:
- [ ] Implementar `search.ts`.
- [ ] Ranking inicial: FTS + importancia + recencia + confianza.

Criterios de aceptación:
- [ ] Nunca devuelve contenido largo por defecto.

### T-6.2 Búsqueda de sesiones

Estado: pending

Tests primero:
- [ ] Incluye sesiones si `include_sessions = true`.
- [ ] No incluye prompts si `include_prompts = false`.
- [ ] Prompts solo aparecen si se pide explícitamente y con permisos locales.

Implementación:
- [ ] Integrar FTS de sesiones/prompts.

Criterios de aceptación:
- [ ] Prompts no contaminan búsqueda normal.

## Fase 7: Tools de Pi

### T-7.1 Registrar tools MVP

Estado: pending

Tests primero:
- [ ] Mock de Pi verifica registro de tools.
- [ ] Schemas rechazan inputs inválidos.

Implementación:
- [ ] Registrar `memory_context`.
- [ ] Registrar `memory_add`.
- [ ] Registrar `memory_search`.
- [ ] Registrar `memory_get`.
- [ ] Registrar `memory_list`.
- [ ] Registrar `memory_update`.
- [ ] Registrar `memory_archive`.
- [ ] Agregar `promptSnippet` y `promptGuidelines` explícitos en tools importantes para que Pi las presente correctamente al modelo.

Criterios de aceptación:
- [ ] Tools devuelven `{ content, details }` compatible con Pi.

### T-7.2 Registrar tools de sesión

Estado: pending

Tests primero:
- [ ] Schemas de sesión válidos.
- [ ] Crear/finalizar sesión actualiza DB.

Implementación:
- [ ] Registrar `memory_start_chat`.
- [ ] Registrar `memory_session_start`.
- [ ] Registrar `memory_session_prompt_add`.
- [ ] Registrar `memory_session_finish`.
- [ ] Registrar `memory_recall`.

Criterios de aceptación:
- [ ] `memory_start_chat` devuelve contexto compacto útil.

## Fase 8: Sesiones y prompts

### T-8.1 Guardar sesiones

Estado: pending

Tests primero:
- [ ] Crea sesión con contexto autodetectado.
- [ ] Finaliza sesión con summary/learned.
- [ ] Guarda architectural decisions como memorias.
- [ ] Guarda learnings como memorias.

Implementación:
- [ ] Implementar `sessions.ts`.

Criterios de aceptación:
- [ ] Sesiones tienen scope/proyecto correcto.

### T-8.2 Guardar prompts para auditoría

Estado: pending

Tests primero:
- [ ] Guarda prompts relevantes por sesión.
- [ ] Redacta/bloquea secretos.
- [ ] Prompts quedan locales y sincronizables a cloud futura.
- [ ] Prompts no aparecen en búsquedas normales.

Implementación:
- [ ] Implementar prompt add.

Criterios de aceptación:
- [ ] Prompts son auditables sin contaminar recall normal.

## Fase 9: Cloud config y sync-aware fields

### T-9.1 Leer cloud config

Estado: pending

Tests primero:
- [ ] `cloud.enabled=false` no requiere env vars.
- [ ] `cloud.enabled=true` requiere organization/actor/remote project.
- [ ] Usa `url_env`/`token_env` personalizados.
- [ ] Usa defaults si no están definidos.
- [ ] Falla sync con error claro si faltan URL/token.

Implementación:
- [ ] Implementar `cloud.ts` config resolver.

Criterios de aceptación:
- [ ] Cloud config no afecta búsqueda local.

### T-9.2 Stubs de sync futura

Estado: pending

Tests primero:
- [ ] Con cloud off, memoria nueva queda `local`.
- [ ] Con cloud on, memoria nueva queda `pending` si no hay push real.
- [ ] Update marca `pending`.

Implementación:
- [ ] Implementar funciones no-op seguras: `maybeQueueSync`, `getSyncStatus`.

Criterios de aceptación:
- [ ] No se hacen requests cloud reales todavía.

## Fase 10: Comandos humanos

### T-10.1 Comandos básicos

Estado: pending

Tests primero:
- [ ] Mock de Pi verifica comandos registrados.

Implementación:
- [ ] Registrar `memory-status` (invocado como `/memory-status`).
- [ ] Registrar `memory-context` (invocado como `/memory-context`).
- [ ] Registrar `memory-search` (invocado como `/memory-search <query>`).
- [ ] Registrar `memory-list` (invocado como `/memory-list`).
- [ ] Registrar `memory-doctor` (invocado como `/memory-doctor`).

Criterios de aceptación:
- [ ] Comandos funcionan sin LLM.

### T-10.2 `memory-doctor`

Estado: pending

Tests primero:
- [ ] Detecta DB inaccesible.
- [ ] Detecta FTS no disponible.
- [ ] Detecta config JSON inválida.
- [ ] Detecta cloud enabled sin env vars.

Implementación:
- [ ] Implementar checks y reporte compacto.

Criterios de aceptación:
- [ ] Ayuda a diagnosticar instalación.

## Fase 11: Lifecycle Pi

### T-11.1 Startup context

Estado: pending

Tests primero:
- [ ] `before_agent_start` inyecta memoria compacta para tareas no triviales.
- [ ] No inyecta exceso de contexto.
- [ ] No incluye prompts completos.

Implementación:
- [ ] Implementar `lifecycle.ts`.
- [ ] Usar `before_agent_start` o `context` según convenga.

Criterios de aceptación:
- [ ] El agente recibe preferencias/reglas/proyecto actual sin ruido.

### T-11.2 Session lifecycle

Estado: pending

Tests primero:
- [ ] `session_start` puede iniciar sesión de memoria.
- [ ] `session_shutdown` puede finalizar o marcar sesión.
- [ ] No duplica sesiones en reload.

Implementación:
- [ ] Integrar eventos `session_start` y `session_shutdown`.

Criterios de aceptación:
- [ ] Sesiones son consistentes entre reload/new/resume.

## Fase 12: Validación end-to-end

### T-12.1 Escenario proyecto

Estado: pending

Tests primero:
- [ ] Crear proyecto fake con `.pi/memory.json`.
- [ ] Agregar memoria project.
- [ ] Buscar desde mismo proyecto.
- [ ] Verificar que otro proyecto no la ve por defecto.

Implementación:
- [ ] Test E2E local con DB temporal.

Criterios de aceptación:
- [ ] Aislamiento de proyecto correcto.

### T-12.2 Escenario HOME

Estado: pending

Tests primero:
- [ ] Desde HOME busca global + general + proyectos.
- [ ] Resultados project muestran origen.

Implementación:
- [ ] Test E2E local.

Criterios de aceptación:
- [ ] Modo HOME no confunde origen.

### T-12.3 Escenario cloud-aware

Estado: pending

Tests primero:
- [ ] Con cloud enabled y sin env vars, local funciona y sync falla claro.
- [ ] Con cloud enabled y env vars, memoria queda preparada para sync.
- [ ] Prompts quedan marcados como auditables/no distribuibles en metadata o política.

Implementación:
- [ ] Test E2E config cloud.

Criterios de aceptación:
- [ ] Cloud no rompe local-first.

## 6. Orden recomendado de implementación

1. T-0.1
2. T-0.2
3. T-1.1
4. T-1.2
5. T-2.1
6. T-2.2
7. T-3.1
8. T-4.1
9. T-4.2
10. T-4.3
11. T-5.1
12. T-5.2
13. T-5.3
14. T-6.1
15. T-7.1
16. T-8.1
17. T-8.2
18. T-9.1
19. T-9.2
20. T-10.1
21. T-10.2
22. T-11.1
23. T-11.2
24. T-12.x

## 7. Definition of Done general

- [ ] Tests pasan.
- [ ] Implementación sigue `docs/memory-tool-spec.md`.
- [ ] No hay referencias a Rust/binarios externos.
- [ ] No se guardan secretos obvios.
- [ ] No se mezclan memorias entre proyectos.
- [ ] Tools devuelven resultados compactos.
- [ ] `memory_get` es el único flujo normal para cargar contenido completo.
- [ ] Cloud config existe pero no afecta búsqueda local.
- [ ] Prompts pueden guardarse para auditoría pero no se inyectan en contexto normal.
