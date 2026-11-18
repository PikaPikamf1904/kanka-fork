import { ribbonFor } from '../lib/statusRibbon.ts';

/** A world-state ribbon (Deceased, Missing, …) from a page's Status field; nothing when unrecognised. */
export function StatusRibbon({ status, placement = 'inline' }: { status: string | null | undefined; placement?: 'inline' | 'card' }) {
  const r = ribbonFor(status);
  if (!r) return null;
  return (
    <span className={`status-ribbon status-${r.kind} status-ribbon-${placement}`} title={r.text} data-testid="status-ribbon">
      {r.label}
    </span>
  );
}
