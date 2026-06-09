# PRD: Sistema de Agentes y Memoria para Desarrollo de Software

## 1. Resumen

Este documento define el producto inicial para un sistema de asistencia de IA orientado al desarrollo de software, compuesto por un agente orquestador, agentes especializados y un sistema de memoria persistente.

El objetivo es permitir que una persona o equipo de desarrollo pueda trabajar con asistencia de IA de forma más estructurada, delegando tareas según su complejidad e impacto, y manteniendo memoria de proyecto y preferencias generales del usuario.

## 2. Problema

El uso de IA en desarrollo suele perder contexto entre sesiones, no diferencia correctamente entre tareas pequeñas y tareas complejas, y puede aplicar cambios sin una metodología clara.

Se necesita un sistema que:

- Entienda el tipo y tamaño de la tarea.
- Seleccione un flujo de trabajo adecuado.
- Delegue trabajo a agentes especializados cuando sea necesario.
- Recuerde información relevante del proyecto.
- Recuerde preferencias generales del usuario.
- Promueva buenas prácticas como TDD para cambios grandes.

## 3. Objetivos

- Crear un flujo de trabajo asistido por IA para desarrollo de software.
- Implementar un agente orquestador capaz de clasificar tareas y elegir el flujo apropiado.
- Definir inicialmente tres niveles de flujo de trabajo:
  1. Inline: tarea pequeña resuelta directamente por el orquestador.
  2. Delegado: tarea media dividida entre 2 o 3 agentes.
  3. SDD/TDD: tarea grande tratada con especificación, diseño y desarrollo guiado por tests.
- Crear una memoria persistente usando SQLite.
- Implementar una extensión de Pi en TypeScript para consultar y guardar memorias.
- Separar memoria de proyecto y memoria general del usuario.

## 4. No objetivos iniciales

- No se busca autonomía completa sin supervisión humana desde el inicio.
- No se busca reemplazar herramientas existentes de gestión de código.
- No se implementará inicialmente una interfaz gráfica compleja.
- No se definirá todavía el nivel final de autonomía de todos los agentes.
- No se integrarán múltiples proveedores de IA en la primera fase salvo que sea necesario.

## 5. Usuarios objetivo

- Usuario principal: desarrollador individual.
- Usuarios secundarios: equipo de desarrollo del usuario.

El sistema debe ser útil tanto para sesiones individuales como para flujos compartidos en equipo.

## 6. Casos de uso principales

### 6.1 Tarea pequeña inline

Ejemplos:

- Corregir un typo.
- Ajustar un mensaje de error.
- Refactor pequeño localizado.
- Añadir una validación simple.

Flujo esperado:

1. El usuario solicita el cambio.
2. El orquestador identifica bajo impacto y baja complejidad.
3. El orquestador inspecciona el código necesario.
4. Aplica el cambio directamente.
5. Ejecuta validación mínima si aplica.
6. Resume el resultado.

### 6.2 Tarea media delegada

Ejemplos:

- Añadir una feature pequeña.
- Corregir un bug que afecta varios archivos.
- Mejorar una función existente con impacto moderado.

Flujo esperado:

1. El usuario solicita el cambio.
2. El orquestador detecta complejidad media.
3. El orquestador delega subtareas a 2 o 3 agentes.
4. Los agentes analizan, proponen o ejecutan partes concretas.
5. El orquestador integra resultados.
6. Se ejecutan pruebas o verificaciones.
7. Se guarda memoria relevante si aplica.

### 6.3 Tarea grande con SDD/TDD

Ejemplos:

- Crear una feature importante.
- Rediseñar un módulo.
- Migrar arquitectura.
- Cambios con riesgo alto o impacto amplio.

Flujo esperado:

1. El orquestador clasifica la tarea como grande.
2. Se inicia flujo SDD: Specification Driven Development.
3. Se genera o actualiza una especificación.
4. Se define diseño técnico.
5. Se genera plan de implementación.
6. Se escriben o actualizan tests primero.
7. Se implementan cambios siguiendo TDD.
8. Se ejecutan pruebas.
9. Se revisa el resultado.
10. Se registran decisiones importantes en memoria.

## 7. Arquitectura conceptual de agentes

### 7.1 Agente orquestador

Responsabilidades:

- Recibir la solicitud del usuario.
- Consultar memoria relevante.
- Clasificar la tarea por complejidad, impacto y riesgo.
- Elegir el flujo de trabajo adecuado.
- Delegar a otros agentes cuando sea necesario.
- Integrar resultados.
- Pedir confirmación humana cuando el riesgo sea alto.
- Guardar aprendizajes, decisiones o preferencias en memoria.

### 7.2 Agentes especializados iniciales

La lista exacta evolucionará, pero inicialmente se contemplan:

#### Agente analista

- Comprende requisitos.
- Identifica alcance.
- Detecta riesgos.
- Propone criterios de aceptación.

#### Agente arquitecto/diseñador

- Propone diseño técnico.
- Evalúa impacto en módulos existentes.
- Define interfaces, componentes o cambios estructurales.

#### Agente implementador

- Modifica código.
- Sigue el plan aprobado.
- Mantiene cambios pequeños y verificables.

#### Agente tester/revisor

- Propone o escribe tests.
- Ejecuta verificaciones.
- Revisa consistencia, regresiones y calidad.

#### Agente de memoria

- Busca contexto relevante.
- Guarda decisiones del proyecto.
- Guarda preferencias generales del usuario.
- Evita duplicados o memorias de bajo valor.

## 8. Sistema de memoria

La memoria será persistente y estará respaldada por SQLite.

Se implementará una extensión de Pi en TypeScript para que los agentes puedan interactuar con la memoria mediante custom tools y comandos de Pi.

### 8.1 Tipos de memoria

#### Memoria de proyecto

Contendrá información específica del repositorio o proyecto actual.

Ejemplos:

- Arquitectura del proyecto.
- Decisiones técnicas.
- Convenciones locales.
- Comandos de build/test/lint.
- Módulos importantes.
- Estado de features en curso.
- Errores conocidos.
- Restricciones del proyecto.

#### Memoria general del usuario

Contendrá preferencias transversales del usuario.

Ejemplos:

- Estilo preferido de comunicación.
- Preferencias de stack.
- Reglas de desarrollo.
- Nivel de detalle deseado.
- Preferencias de testing.
- Convenciones personales.

### 8.2 Operaciones mínimas de la extensión de memoria

La extensión TypeScript de Pi deberá permitir como mínimo:

- `add`: guardar una memoria.
- `search`: buscar memorias relevantes.
- `list`: listar memorias filtradas.
- `update`: actualizar una memoria.
- `delete`: eliminar o desactivar una memoria.

### 8.3 Campos iniciales de una memoria

Campos propuestos:

- `id`
- `scope`: `project` o `global`
- `project_id`: opcional para memoria global, requerido para proyecto
- `kind`: preferencia, decisión, comando, arquitectura, restricción, nota, tarea, etc.
- `content`
- `tags`
- `source`: usuario, agente, importación, etc.
- `confidence`
- `created_at`
- `updated_at`
- `last_accessed_at`

## 9. Selección de flujo de trabajo

El orquestador decidirá el flujo según criterios como:

- Número de archivos afectados.
- Riesgo de romper funcionalidad existente.
- Necesidad de tests.
- Ambigüedad de los requisitos.
- Impacto arquitectónico.
- Duración estimada.
- Si requiere decisiones de producto o diseño.

### 9.1 Flujo inline

Criterios aproximados:

- Bajo riesgo.
- Pocos archivos.
- Requisitos claros.
- Sin impacto arquitectónico.

### 9.2 Flujo delegado

Criterios aproximados:

- Riesgo medio.
- Varios archivos.
- Requiere análisis o revisión.
- Puede dividirse en subtareas.

### 9.3 Flujo SDD/TDD

Criterios aproximados:

- Riesgo alto.
- Cambios amplios.
- Feature importante.
- Requiere diseño previo.
- Requiere tests antes o durante la implementación.

## 10. Requisitos funcionales

- El sistema debe aceptar una tarea de desarrollo en lenguaje natural.
- El orquestador debe clasificar la tarea antes de actuar.
- El orquestador debe consultar memoria relevante antes de ejecutar tareas no triviales.
- El sistema debe soportar memoria global y memoria de proyecto.
- El sistema debe poder guardar nuevas memorias mediante custom tools de la extensión de Pi.
- El sistema debe poder buscar memorias mediante SQLite.
- El sistema debe permitir flujos inline, delegados y SDD/TDD.
- Para tareas grandes, el sistema debe generar especificación y plan antes de implementar.
- Para tareas grandes, el sistema debe favorecer TDD.
- El sistema debe resumir cambios realizados y verificaciones ejecutadas.

## 11. Requisitos no funcionales

- Debe ser simple de ejecutar localmente.
- Debe funcionar bien en repositorios de software existentes.
- La memoria debe ser portable mediante un archivo SQLite.
- La extensión de memoria debe ser rápida y confiable.
- Las acciones destructivas deben requerir confirmación o ser claramente visibles.
- Debe minimizar escritura de memorias irrelevantes.
- Debe mantener trazabilidad de decisiones importantes.

## 12. Seguridad y permisos

- El sistema no debe almacenar secretos en memoria.
- Debe evitar guardar tokens, passwords, claves privadas o datos sensibles.
- La memoria debe poder auditarse y editarse.
- Las operaciones destructivas sobre código o memoria deben tener controles.
- En flujos de alto impacto, el usuario debe poder aprobar el plan antes de ejecutar.

## 13. Métricas de éxito

- Reducción del tiempo necesario para completar tareas de desarrollo.
- Menos pérdida de contexto entre sesiones.
- Mayor consistencia con preferencias del usuario.
- Mayor calidad en cambios grandes mediante SDD/TDD.
- Capacidad de recuperar decisiones pasadas del proyecto.
- Menor número de regresiones en cambios asistidos por IA.

## 14. Riesgos

- Guardar demasiada memoria irrelevante.
- Clasificar incorrectamente tareas grandes como pequeñas.
- Delegar excesivamente tareas simples.
- Complejidad innecesaria en el sistema de agentes.
- Inconsistencia entre memoria global y memoria de proyecto.
- Riesgo de almacenar información sensible por error.

## 15. MVP propuesto

### Fase 1: PRD y diseño

- Definir PRD.
- Definir flujos iniciales.
- Definir modelo de memoria.
- Definir custom tools y comandos de la extensión de Pi.

### Fase 2: Memoria local

- Crear extensión de Pi en TypeScript.
- Crear esquema SQLite.
- Implementar `add`, `search`, `list`.
- Añadir soporte para memoria global y de proyecto.

### Fase 3: Orquestador básico

- Crear reglas de clasificación de tareas.
- Implementar flujo inline.
- Implementar consulta básica de memoria.

### Fase 4: Flujos delegados

- Definir agentes especializados.
- Implementar flujo de tarea media con 2 o 3 agentes.
- Integrar resultados en el orquestador.

### Fase 5: SDD/TDD

- Definir plantillas de especificación.
- Definir flujo de diseño técnico.
- Implementar ciclo test-first para tareas grandes.

## 16. Preguntas abiertas

- ¿Dónde vivirá la configuración de agentes?
- ¿El sistema se integrará directamente con pi, con otro agente, o será independiente?
- ¿Cómo se identificará cada proyecto en memoria?
- ¿La búsqueda de memoria será inicialmente por texto simple, FTS5 o embeddings?
- ¿Qué nivel de aprobación humana se exigirá para cada flujo?
- ¿Qué formato tendrán las especificaciones SDD?
- ¿Cómo se auditarán las memorias guardadas por agentes?
