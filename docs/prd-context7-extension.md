# PRD: Extensión Context7 para Pi

## 1. Resumen

Implementar una extensión nativa de Pi para consultar documentación actualizada desde Context7 usando el SDK TypeScript `@upstash/context7-sdk`, evitando un adaptador MCP adicional.

La extensión expondrá tools de Pi para resolver librerías, buscar documentación y obtener contexto relevante para el agente durante diseño, implementación y verificación, especialmente dentro del flujo SDD.

## 2. Contexto

Context7 ofrece documentación actualizada para librerías y frameworks. La documentación oficial indica que el SDK TypeScript permite:

- buscar librerías disponibles;
- obtener contexto/documentación para una librería;
- acceder a metadata como `trustScore`, `benchmarkScore`, snippets y versiones.

El SDK está marcado como **Work in Progress**, por lo que la integración debe aislar su uso detrás de un cliente interno para absorber cambios de API.

Fuentes revisadas:

- `https://context7.com/docs/sdks/ts/getting-started.md`
- `https://context7.com/docs/sdks/ts/commands/search-library.md`
- `https://context7.com/docs/sdks/ts/commands/get-context.md`
- `https://context7.com/docs/api-guide.md`
- docs de extensiones/SDK de Pi.

## 3. Problema

Hoy el agente depende de conocimiento interno o búsqueda manual para consultar documentación externa de librerías. Eso puede producir:

- respuestas desactualizadas;
- errores de implementación por APIs cambiantes;
- sobrecarga del usuario pasando documentación a mano;
- necesidad de un proceso MCP extra si se integra Context7 por esa vía.

Se necesita una integración directa, controlada y testeable dentro de Pi.

## 4. Objetivos

- Crear una extensión TypeScript de Pi en `.pi/extensions/context7/`.
- Usar `@upstash/context7-sdk` directamente.
- Exponer tools de Pi para:
  - buscar/resolver librerías;
  - obtener documentación relevante;
  - obtener contexto en formato compacto para prompts.
- Leer API key solo desde entorno (`CONTEXT7_API_KEY`), nunca desde archivos versionados.
- Manejar errores y rate limits de forma clara para el agente.
- Preparar cache local opcional para reducir llamadas repetidas.
- Integrar el uso de Context7 con el workflow SDD cuando se necesite documentación actualizada.

## 5. No objetivos iniciales

- No implementar MCP.
- No crear UI compleja.
- No subir/agregar librerías a Context7 en la primera versión.
- No modificar políticas/teamspaces de Context7.
- No guardar respuestas completas de Context7 en Pi Memory automáticamente.
- No guardar API keys ni tokens en `.pi/context7.json` o archivos del repo.

## 6. Usuarios objetivo

- Usuario principal: desarrollador usando Pi para implementar, diseñar o validar software.
- Agente orquestador y subagentes SDD que necesiten consultar documentación externa actualizada.

## 7. Casos de uso

### 7.1 Resolver librería

El agente necesita saber cuál es el ID Context7 correcto para una librería.

Flujo:

1. El agente llama `context7_search_library` con `libraryName` y `query`.
2. La tool devuelve candidatos con `id`, `name`, `description`, `trustScore`, `benchmarkScore`, `totalSnippets` y `versions`.
3. El agente elige el mejor ID o pide aclaración si hay ambigüedad.

### 7.2 Obtener documentación puntual

El agente necesita documentación actual para una pregunta concreta.

Flujo:

1. El agente ya tiene un `libraryId`, por ejemplo `/vercel/next.js`.
2. Llama `context7_get_context` con `query`, `libraryId` y formato `json` o `txt`.
3. La tool devuelve snippets compactos o texto listo para usar.
4. El agente cita/resume lo relevante y aplica la documentación al trabajo.

### 7.3 Workflow completo resolver + consultar

El agente no conoce el ID de la librería.

Flujo:

1. `context7_search_library` para resolver candidatos.
2. Selección del mejor candidato por exactitud, descripción, `trustScore`, `benchmarkScore` y versiones.
3. `context7_get_context` con query específica.

### 7.4 SDD design/apply/verify

Durante `sdd-design`, `sdd-apply` o `sdd-verify`, un subagente necesita docs actuales de una dependencia.

Flujo:

1. El subagente identifica librería y versión desde el repo.
2. Consulta Context7 solo si la documentación afecta una decisión o implementación.
3. Registra en su artifact SDD qué documentación usó, sin guardar respuestas completas en memoria salvo resumen útil.

## 8. API propuesta de tools Pi

### 8.1 `context7_status`

Verifica configuración básica.

Parámetros: ninguno.

Respuesta esperada:

- SDK disponible: sí/no.
- API key presente: sí/no, sin exponer valor.
- Cache habilitado: sí/no.

### 8.2 `context7_search_library`

Busca librerías.

Parámetros:

```ts
{
  libraryName: string;
  query: string;
  limit?: number;
}
```

Respuesta compacta:

```ts
{
  results: Array<{
    id: string;
    name: string;
    description: string;
    totalSnippets: number;
    trustScore: number;
    benchmarkScore: number;
    versions?: string[];
  }>;
}
```

### 8.3 `context7_get_context`

Obtiene documentación para una librería.

Parámetros:

```ts
{
  libraryId: string;
  query: string;
  type?: "json" | "txt";
  max_chars?: number;
}
```

Respuesta:

- Para `json`: snippets con `title`, `content`, `source`, truncados si aplica.
- Para `txt`: texto truncado a `max_chars`.

### 8.4 `context7_resolve_and_get_context`

Tool de conveniencia para resolver librería y obtener contexto en una sola llamada.

Parámetros:

```ts
{
  libraryName: string;
  query: string;
  version?: string;
  max_chars?: number;
}
```

Reglas:

- Usa `context7_search_library` internamente.
- Selecciona el mejor resultado por exactitud/trust/benchmark.
- Si hay ambigüedad fuerte, devuelve candidatos y pide selección en vez de inventar.

## 9. Configuración

### Variables de entorno

- `CONTEXT7_API_KEY`: API key oficial de Context7.

### Config opcional del proyecto

Archivo opcional: `.pi/context7.json`

No debe contener secretos.

Ejemplo:

```json
{
  "cache": {
    "enabled": true,
    "ttl_seconds": 86400
  },
  "defaults": {
    "max_chars": 12000,
    "result_limit": 5
  }
}
```

## 10. Seguridad

- Nunca guardar `CONTEXT7_API_KEY` en archivos del repo.
- `context7_status` solo indica presencia/ausencia de la key.
- No guardar respuestas completas de docs en memoria automáticamente.
- Truncar outputs grandes para evitar sobrecargar el contexto.
- Manejar errores 401/403 sin imprimir secretos.

## 11. Errores y rate limits

Context7 puede devolver errores estándar como:

- `401`: API key inválida.
- `403`: acceso denegado.
- `404`: librería no encontrada.
- `429`: rate limit.
- `5xx`: error transitorio.

La extensión debe:

- capturar `Context7Error` del SDK;
- devolver mensajes accionables;
- respetar `Retry-After` cuando sea posible;
- recomendar queries más específicas si no hay resultados.

## 12. Cache

Cache inicial opcional, local-first.

Clave sugerida:

```txt
context7:<method>:<libraryId|libraryName>:<query>:<type>:<version>
```

Requisitos:

- TTL configurable.
- Cache no debe incluir API key.
- Debe poder desactivarse.
- Primera versión puede usar archivo JSON o SQLite simple; preferir modularidad para cambiar después.

## 13. Arquitectura esperada

```txt
.pi/extensions/context7/
  package.json
  index.ts
  src/
    config.ts
    client.ts
    cache.ts
    tools.ts
    security.ts
    types.ts
    utils.ts
  test/
    config.test.ts
    client.test.ts
    tools.test.ts
    cache.test.ts
```

Módulos:

- `config.ts`: lee env y `.pi/context7.json` sin secretos.
- `client.ts`: wrapper sobre `@upstash/context7-sdk`.
- `tools.ts`: registra tools Pi.
- `cache.ts`: TTL cache opcional.
- `security.ts`: redacción/truncado/validación.

## 14. Dependencias

- Runtime: `@upstash/context7-sdk`.
- Tool schemas: `typebox`.
- Tests: `vitest`.
- Pi extension API: `@earendil-works/pi-coding-agent` como referencia de tipos si hace falta.

## 15. Criterios de aceptación

- [ ] La extensión carga con `/reload` sin errores.
- [ ] `context7_status` no expone secretos.
- [ ] `context7_search_library` usa `Context7.searchLibrary(query, libraryName)`.
- [ ] `context7_get_context` usa `Context7.getContext(query, libraryId, options)`.
- [ ] Errores `Context7Error` se devuelven de forma accionable.
- [ ] Outputs grandes se truncan con aviso.
- [ ] Tests cubren config, tools, errores y cache.
- [ ] Documentación SDD indica cuándo usar Context7.

## 16. Riesgos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| SDK Work in Progress con cambios breaking | Medio/Alto | Aislar en `client.ts`; tests unitarios con mocks. |
| API key ausente | Medio | `context7_status` claro y tools con error accionable. |
| Rate limits | Medio | Cache TTL, mensajes sobre `Retry-After`, queries específicas. |
| Exceso de contexto | Medio | `max_chars`, snippets compactos, preferir queries específicas. |
| Selección incorrecta de librería | Medio | Exponer metadata y pedir aclaración ante ambigüedad. |

## 17. Preguntas abiertas

- ¿Queremos cache en MVP o dejarlo para fase 2?
- ¿La extensión debería estar disponible para todos los subagentes SDD por defecto?
- ¿Permitimos `context7_resolve_and_get_context` en una sola tool o preferimos obligar a resolver primero?
- ¿Queremos registrar en artifacts SDD las fuentes Context7 usadas durante design/apply/verify?
