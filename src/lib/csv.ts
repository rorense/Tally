/**
 * Escapes one CSV field.
 *
 * The leading apostrophe is not decoration. A spreadsheet reads a cell starting
 * with `=`, `+`, `-` or `@` as a formula, so a description typed as `=1+1` —
 * or something rather less playful — runs the moment the file is opened, on
 * whatever machine it was mailed to. Excel and Sheets both take the apostrophe
 * to mean "this cell is text". Numbers are left alone so a negative amount
 * stays a number rather than becoming the string `'-12.5`.
 *
 * The .xlsx export needs no equivalent: it writes inline strings, which are
 * never parsed as formulas.
 */
export function csvEscape(value: string | number): string {
  if (typeof value === 'number') return String(value);
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}
