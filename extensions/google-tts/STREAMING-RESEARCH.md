# Investigación: reproducción progresiva con Google TTS

Fecha de revisión: 28 de octubre de 2026.
Estado: investigación terminada; implementación y prueba real de streaming pendientes.

## Conclusión y siguiente paso

**Los modelos que ya usa esta extensión soportan salida de audio en streaming. La extensión actual no la aprovecha: espera un audio completo y separa generación de reproducción.**

La mejora más acotada es conservar proveedor, modelos, autenticación y reenvío de audio, pero consumir `streamGenerateContent` y alimentar el reproductor por fragmentos. Esto permitiría escuchar antes de que termine la síntesis, aunque el texto se envíe completo.

Antes de implementar, acordar el comportamiento de los controles con el usuario. La petición que originó este documento autoriza únicamente dejar la investigación dentro de la extensión; **no autoriza cambios de código, dependencias, configuración, credenciales, llamadas facturables ni reproducción automática**.

## Tres capacidades que no hay que confundir

| Capacidad | Significado | Situación |
|---|---|---|
| Streaming de salida TTS | Enviar texto completo y escuchar audio a medida que se sintetiza. | Documentado para los modelos actuales mediante `streamGenerateContent`. |
| Streaming bidireccional TTS | Enviar texto por partes mientras otro LLM escribe y recibir audio simultáneamente. | No es el contrato de la llamada Vertex usada aquí. Google Cloud TTS ofrece otra interfaz, `StreamingSynthesize`, con modelos compatibles. |
| Transcripción en streaming | Enviar audio del micrófono y recibir texto progresivamente. | Google Speech-to-Text V2 ofrece `StreamingRecognize`, por ejemplo con `chirp_3`, mediante gRPC. No está implementado en esta extensión. |

El contexto de la conversación era generar voz a partir de respuestas de Pi. La referencia del usuario a «transcripción» no debe convertirse automáticamente en un requisito de micrófono o reconocimiento de voz.

## Estado actual comprobado en el código

| Evidencia | Archivo y símbolo | Comportamiento observado |
|---|---|---|
| E1 | [index.ts](index.ts), registro de `agent_settled` | Los controles se añaden después de que el agente quede asentado. No se consume el texto incremental del LLM. |
| E2 | [src/manual-audio.ts](src/manual-audio.ts), `ManualAudio.action` | `generate` espera `service.synthesize(...)`, almacena un `Buffer` completo y pasa a `ready`. `play` es otra acción posterior. |
| E3 | [src/tts-service.ts](src/tts-service.ts), `GoogleTTSService.synthesize` | Llama a `:generateContent`, espera `res.json()` y decodifica el audio completo. Devuelve `Promise<Buffer>`. |
| E4 | [src/audio-player.ts](src/audio-player.ts), `AudioPlayer.play` | Arranca `ffplay` y entrega todo el buffer con `stdin.end(audioBuffer)`. No tiene una entrada incremental de audio. |
| E5 | [README.md](README.md) | Documenta el flujo manual separado, el límite de 3000 caracteres, pausa/reanudación, conservación del audio en memoria y reenvío remoto. |

Configuración predeterminada documentada y observada:

- Proveedor: Google Cloud, endpoint `aiplatform.googleapis.com`.
- Modelo: `gemini-3.8-flash-tts`; alternativa `gemini-3.8-flash-lite-tts`.
- Ubicación: `global`.
- Voz inicial: `Kore`; estilo inicial alegre y cercano; velocidad de reproducción inicial 1.18x.
- Autenticación: cuenta de servicio local y token OAuth. No se abrieron `.env` ni el JSON privado para esta investigación.

Los comandos de sesión pueden cambiar modelo, voz, estilo y velocidad; estos valores no prueban cuál está seleccionado en una sesión viva concreta.

## Contrato de streaming documentado para los modelos actuales

Google documenta ambos modelos con este endpoint REST:

```text
POST https://aiplatform.googleapis.com/v1/projects/PROJECT_ID/locations/global/publishers/google/models/MODEL:streamGenerateContent?alt=sse
```

Se envía una sola petición con todo el texto. La respuesta llega como eventos SSE con fragmentos de audio base64 en las partes `inlineData`.

| Método | Formato predeterminado documentado |
|---|---|
| `generateContent` | WAV completo con cabecera RIFF; PCM de 16 bits, 24 kHz, mono. |
| `streamGenerateContent` | PCM sin cabecera, signed little-endian de 16 bits, 24 kHz, mono. |

Ejemplo conceptual del cuerpo, sin credenciales ni proyecto real:

```json
{
  "contents": [{
    "role": "user",
    "parts": [{
      "text": "Hola, esta es una prueba breve.",
      "speechMetadata": {"style": "cheerful and friendly"}
    }]
  }],
  "generationConfig": {
    "responseModalities": ["AUDIO"],
    "speechConfig": {"voiceConfig": {"voice": "Kore"}}
  }
}
```

El PCM incremental necesita parámetros explícitos de formato en el reproductor. No se puede asumir que el comando actual, que autodetecta un archivo completo, vaya a reconocer PCM sin cabecera. Tampoco se deben concatenar cabeceras WAV por fragmento.

**Límite de evidencia:** este soporte está verificado en documentación oficial, no mediante una llamada real de esta extensión. Los modelos figuran como Preview; confirmar disponibilidad y contrato vigentes antes de implementar.

## Si se quiere hablar mientras Pi todavía escribe

Eso es un objetivo distinto y más amplio:

- La extensión actual espera `agent_settled` deliberadamente. Cambiarlo por eventos incrementales podría leer respuestas intermedias, mensajes que después llaman herramientas o texto de una generación abortada.
- Vertex con `streamGenerateContent` no permite añadir texto a una petición ya enviada.
- Cloud Text-to-Speech ofrece `StreamingSynthesize`: múltiples mensajes de texto y respuestas de audio en una misma conexión. Chirp 3 HD es una opción documentada; confirmar idioma, voz, región, permisos y coste.
- La guía de migración especifica que **Gemini 3.8 TTS no está disponible en Cloud Text-to-Speech**. No asumir que cambiar de transporte conserva los modelos de esta extensión.
- Gemini Live está orientado a conversación generativa en tiempo real; no equivale a un lector que deba recitar exactamente la salida de otro LLM.
- Dividir el texto en solicitudes TTS independientes también sería una arquitectura distinta: puede introducir pausas, variaciones de prosodia, nuevos costes y decisiones sobre fragmentación.

No ampliar a estas opciones sin autorización específica.

## Decisiones pendientes antes de editar

1. **Controles:** ¿añadir «Generar y escuchar» manteniendo «Generar» y «Reproducir», o sustituir el flujo existente? La separación actual fue intencional; no eliminarla por inferencia.
2. **Momento de inicio:** ¿mantener el clic manual después de la respuesta final? La investigación no autoriza lectura automática durante la generación del LLM.
3. **Audio reutilizable:** ¿conservar los fragmentos para repetir el audio sin otra llamada? Definir qué pasa si se cancela antes de completar.
4. **Pausa:** ¿se pausa solo el reproductor mientras la generación continúa, o se cancela también la síntesis? No prometer que pausar el sonido pausa consumo o facturación upstream.

Recomendación, todavía no aprobada: comenzar con texto completo y reproducción progresiva activada manualmente, sin cambiar de modelo ni introducir servicios adicionales.

## Superficie técnica candidata, no autorización de cambio

- `src/tts-service.ts`: transporte incremental SSE, extracción de todos los fragmentos de audio, formato y cancelación real de red.
- `src/audio-player.ts`: escritura incremental de PCM, control de presión de escritura, formato explícito y cierre seguro.
- `src/manual-audio.ts`: estados coherentes cuando síntesis y reproducción se superponen; caché, cancelación y resultado incompleto.
- `src/render.ts`, `index.ts`: solo si el comportamiento de controles aprobado lo exige.
- `test/` y `README.md`: cobertura y contrato público del cambio aprobado.

No leer credenciales para desarrollar pruebas con mocks. No imprimir tokens, cuerpos OAuth ni material privado. No modificar `.env`, el JSON de cuenta de servicio, ajustes globales de Pi, túneles SSH o dispositivos de audio como atajo.

## Validación propuesta

Primero reutilizar el entorno y las pruebas existentes:

```bash
node --test test/*.test.ts
```

En esta investigación no se ejecutaron esas pruebas; se propone el comando que documenta la extensión.

Para una implementación autorizada, cubrir al menos:

- Eventos SSE divididos entre lecturas, varios eventos en una lectura y varias partes de audio.
- Inicio de reproducción antes de completar la síntesis, sin perder, duplicar o reordenar bytes.
- Cancelación durante autenticación, lectura de red y reproducción; cierre de tuberías y procesos.
- Error de proveedor, stream incompleto, audio ausente, `EPIPE` y salida temprana de `ffplay`.
- Control de presión de escritura y límites de memoria, especialmente durante pausa.
- Reproducción repetida sin facturar otra generación, si se acuerda conservarla.
- Comportamiento al desactivar TTS, iniciar otro prompt, cambiar rama, recargar o cerrar Pi.
- Regresión del modo manual, velocidad, pausa/reanudación y salida remota existentes.

Después, con autorización para una llamada real breve, medir por separado: inicio de petición, primer fragmento con audio, comienzo del envío al reproductor y fin de síntesis. El momento en que se escribe a `ffplay` no demuestra por sí solo cuándo el usuario lo oye: reproductor, túnel y dispositivo añaden búferes. Confirmar audibilidad con el usuario.

El reenvío PulseAudio existente está documentado en el README. Reutilizarlo y comprobar su disponibilidad; no recrearlo ni asumir que pertenece al mismo dispositivo en futuras sesiones.

## Fuentes oficiales y límites

Consultadas el 28 de octubre de 2026:

1. [Generar voz con Gemini TTS](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/text-to-speech/overview): modelos actuales, `streamGenerateContent`, SSE y PCM incremental.
2. [Migración a Gemini 3.8 TTS](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/text-to-speech/migration-guide): disponibilidad, modelos, formatos y diferencias con Cloud Text-to-Speech.
3. [Gemini TTS en Cloud Text-to-Speech](https://docs.cloud.google.com/text-to-speech/docs/gemini-tts): diferencias entre petición única con respuestas progresivas y streaming bidireccional; advertencia específica sobre Gemini 3.8.
4. [Síntesis bidireccional de Cloud TTS](https://docs.cloud.google.com/text-to-speech/docs/create-audio-text-streaming): envío progresivo de texto mediante `StreamingSynthesize`.
5. [Chirp 3 HD](https://docs.cloud.google.com/text-to-speech/docs/chirp3-hd): voces y capacidades de síntesis streaming.
6. [Transcripción desde audio en streaming](https://docs.cloud.google.com/speech-to-text/docs/streaming-recognize) y [Chirp 3 para transcripción](https://docs.cloud.google.com/speech-to-text/docs/models/chirp-3): servicio separado de reconocimiento de voz.

Las fuentes y el código pueden cambiar. Se inspeccionaron README, entrypoint, servicio TTS, controlador manual y reproductor. No se inspeccionó el contenido de credenciales; no se realizaron llamadas Google, pruebas de latencia, instalación de dependencias, cambios de comportamiento ni modificaciones de configuración. Este documento no es un plan de implementación aprobado.
