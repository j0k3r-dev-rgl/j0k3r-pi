const htmlEntities: Record<string, string> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"',
};

export function decodeEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_match, codepoint: string) => String.fromCodePoint(Number(codepoint)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, codepoint: string) => String.fromCodePoint(parseInt(codepoint, 16)))
    .replace(/&([a-z][a-z0-9]+);/gi, (match, name: string) => htmlEntities[name] ?? match);
}

export function cleanText(value: string | undefined): string | undefined {
  const text = value ? decodeEntities(value).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : undefined;
  return text || undefined;
}
