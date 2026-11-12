// Per-device storage for beta features. Nothing here is sent anywhere; reads and writes never
// throw (private windows, blocked storage), and every key is scoped to the signed-in member.

export function load<T>(key: string, fallback: T, parse: (raw: unknown) => T = (r) => r as T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : parse(JSON.parse(raw));
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked: the feature still works for this visit */
  }
}

export const keyFor = (feature: string, userId: string) => `chronicle.beta.${feature}.${userId}`;

/** True on the beta preview site (beta.<project>.pages.dev) and in local development. */
export const isBetaSite = () => typeof window !== 'undefined' && (window.location.hostname.startsWith('beta.') || import.meta.env.DEV);
