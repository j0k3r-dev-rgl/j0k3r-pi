/**
 * Limpia y normaliza el texto de la respuesta del modelo
 * para que la síntesis de voz sea completa, fluida, natural y sin sintaxis técnica.
 */
export function cleanTextForSpeech(rawText: string, maxChars: number = 3000): string {
  if (!rawText || typeof rawText !== "string") {
    return "";
  }

  let text = rawText;

  // 1. Eliminar bloques de código completos (```...```)
  text = text.replace(/```[\s\S]*?```/g, " ");

  // 2. Reemplazar enlaces Markdown [texto](url) por solo "texto"
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

  // 3. Eliminar URLs directas
  text = text.replace(/https?:\/\/\S+/g, " ");

  // 4. Eliminar tags HTML o XML (ej. <tool_call>, <details>, etc.)
  text = text.replace(/<[^>]+>/g, " ");

  // 5. Eliminar comillas de código inline (`codigo` -> codigo)
  text = text.replace(/`([^`]+)`/g, "$1");

  // 6. Eliminar encabezados y símbolos de hashtags (#, ##, ###)
  text = text.replace(/#+/g, "");

  // 7. Eliminar negritas, cursivas y tachados (**, *, __, _, ~~)
  text = text.replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, "$1");

  // 8. Reemplazar viñetas de listas (*, -, +) y numeraciones al inicio de línea
  text = text.replace(/^[\s]*[-*+]\s+/gm, "");
  text = text.replace(/^[\s]*\d+\.\s+/gm, "");

  // 9. Eliminar separadores horizontales (---, ===, ***)
  text = text.replace(/^[-=*_]{3,}$/gm, " ");

  // 10. Reemplazar bloques de citas (> texto)
  text = text.replace(/^>\s+/gm, "");

  // 11. Eliminar emojis comunes o símbolos decorativos excesivos
  text = text.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, "");

  // 12. Normalizar pausas, saltos de línea y espacios en blanco
  text = text.replace(/\n+/g, ". ");
  text = text.replace(/\s+/g, " ").trim();
  text = text.replace(/\s*\.\s*\./g, ".");
  text = text.replace(/([,;?!])\s*\./g, "$1");
  text = text.replace(/([,;?!])\s*/g, "$1 ");
  text = text.replace(/\.\s+/g, ". ");
  text = text.replace(/\s+([.,;?!])/g, "$1");
  text = text.replace(/^[.\s,;?!]+/, "").trim();

  // 13. Limitar longitud máxima respetando el final de una frase solo si sobrepasa el límite
  if (text.length > maxChars) {
    const truncated = text.slice(0, maxChars);
    const lastPeriod = Math.max(
      truncated.lastIndexOf(". "),
      truncated.lastIndexOf("? "),
      truncated.lastIndexOf("! ")
    );
    if (lastPeriod > maxChars * 0.7) {
      text = truncated.slice(0, lastPeriod + 1).trim();
    } else {
      text = truncated.trim() + "...";
    }
  }

  return text;
}
