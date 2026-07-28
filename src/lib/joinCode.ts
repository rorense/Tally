/**
 * Join codes are typed by hand from a partner's phone screen, so we accept the
 * hyphenated form we generate and the same eight characters without punctuation.
 */
export function normalizeJoinCode(raw: string): string {
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (cleaned.length !== 8) return cleaned;
  return `${cleaned.slice(0, 4)}-${cleaned.slice(4)}`;
}

export function isCompleteJoinCode(raw: string): boolean {
  return /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(normalizeJoinCode(raw));
}
