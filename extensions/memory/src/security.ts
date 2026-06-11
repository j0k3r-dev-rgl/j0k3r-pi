const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gi,
  /\b(?:password|passwd|pwd|token|api[_-]?key|secret|private[_-]?key)\b\s*[:=]\s*['\"]?[^'\"\s]{8,}/gi,
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g,
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g,
];

export function containsSecret(text: string): boolean { return SECRET_PATTERNS.some((re) => { re.lastIndex = 0; return re.test(text); }); }

export function redactSecrets(text: string): { text: string; redacted: boolean } {
  let out = text;
  for (const re of SECRET_PATTERNS) out = out.replace(re, '[REDACTED_SECRET]');
  return { text: out, redacted: out !== text };
}

export function assertSafeText(text: string): void {
  if (containsSecret(text)) throw new Error('Refusing to store content that appears to contain a secret.');
}
