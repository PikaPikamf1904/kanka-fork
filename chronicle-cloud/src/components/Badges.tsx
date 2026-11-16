import type { PublishStatus, Visibility } from '../lib/types.ts';

export function VisibilityBadge({ visibility }: { visibility: Visibility }) {
  if (visibility === 'players') return <span className="badge badge-players">Players</span>;
  return (
    <span className="badge badge-dm" title="Only the DM can see this">
      DM only
    </span>
  );
}

export function StatusBadge({ status }: { status: PublishStatus }) {
  return status === 'published' ? <span className="badge badge-published">Published</span> : <span className="badge badge-draft">Draft</span>;
}
