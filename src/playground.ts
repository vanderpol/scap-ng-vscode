/** Offline, bounded regex preview. This never evaluates an Assessment or claims compliance. */
export interface RegexPreview { dialect: 'ECMAScript'; pattern: string; input: string; matched: boolean; captures: string[]; error?: string; limited: boolean; }
export function previewRegex(pattern: string, input: string, flags = ''): RegexPreview {
  const bounded = input.slice(0, 100_000);
  if (pattern.length > 10_000 || input.length > 100_000) return { dialect: 'ECMAScript', pattern, input: bounded, matched: false, captures: [], error: 'Preview input or pattern exceeds the offline safety limit.', limited: true };
  try {
    const expression = new RegExp(pattern, flags);
    const match = expression.exec(bounded);
    return { dialect: 'ECMAScript', pattern, input: bounded, matched: Boolean(match), captures: match ? [...match].slice(1) : [], limited: bounded.length !== input.length };
  } catch (error) {
    return { dialect: 'ECMAScript', pattern, input: bounded, matched: false, captures: [], error: error instanceof Error ? error.message : String(error), limited: false };
  }
}
