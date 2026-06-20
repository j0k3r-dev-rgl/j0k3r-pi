export function joinDefined(parts: Array<string | undefined>, separator = ' | '): string {
  return parts.filter((part): part is string => Boolean(part)).join(separator);
}

export function compactAuthors(authors: string[] | undefined, max = 3): string | undefined {
  if (!authors || authors.length === 0) return undefined;
  const shown = authors.slice(0, max).join(', ');
  return authors.length > max ? `${shown}, et al.` : shown;
}
