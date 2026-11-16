// "Infobox field browse": a short plain infobox value (Race: Elf, Allegiance: The Crown) links to
// every page that shares it. Pure helpers for which values qualify and for counting values.

/** Whether a field value is short plain text worth browsing by (not a link, sentence or number). */
export function browsableValue(value: string): boolean {
  const v = value.trim();
  if (!v || v.length > 40) return false;
  if (/\[\[|\]\(|https?:|\n/.test(v)) return false;
  if (/\d/.test(v)) return false; // dates, ages, levels and other numbers
  return v.split(/\s+/).length <= 5;
}

export const factsHref = (label: string, value: string) =>
  `/facts?${new URLSearchParams({ label: label.trim(), value: value.trim() }).toString()}`;

/** Distinct values of one label with how many pages use each, most used first. */
export function valueCounts(values: string[]): { value: string; count: number }[] {
  const byKey = new Map<string, { value: string; count: number }>();
  for (const raw of values) {
    const v = raw.trim();
    if (!browsableValue(v)) continue;
    const k = v.toLowerCase();
    const e = byKey.get(k) ?? { value: v, count: 0 };
    e.count++;
    byKey.set(k, e);
  }
  return [...byKey.values()].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}
