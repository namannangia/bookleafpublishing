/** Caps untrusted text so one very long ticket can't blow up token spend. */
export function truncate(text: string, maxChars: number): string {
  const clean = text.trim();
  return clean.length <= maxChars ? clean : `${clean.slice(0, maxChars)}… [truncated]`;
}
