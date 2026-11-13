import '../../styles/images.css';
import { useRef, useState, type DragEvent } from 'react';
import { Link } from 'react-router';
import { MediaImage } from '../../components/MediaImage.tsx';
import { deleteMedia, listMedia, mediaUrls, mediaUsage, savePhoto, updateMedia, type MediaItem, type MediaUse } from '../../lib/api.ts';
import { IMAGE_TYPES, MAX_ARTICLE_IMAGE, MAX_SOURCE_IMAGE, readImageSize, renderImage } from '../../lib/image.ts';
import { useLoad } from '../../lib/useLoad.ts';

const kb = (n: number | null) => (n ? `${Math.max(1, Math.round(n / 1024))} KB` : '');
const nameOf = (m: MediaItem) => m.original_name || m.alt || 'Untitled picture';

/** DM: every uploaded picture, where it is used, and who can see it. */
export function MediaLibrary() {
  const data = useLoad(async () => {
    const [items, usage] = await Promise.all([listMedia(), mediaUsage()]);
    await mediaUrls(items.slice(0, 200).map((m) => m.id));
    return { items, usage };
  }, []);
  const [over, setOver] = useState(false);
  const busy = useRef(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'unused' | 'players'>('all');

  async function upload(list: FileList | null) {
    const files = [...(list ?? [])];
    if (!files.length || busy.current) return;
    busy.current = true;
    setError(null);
    let done = 0;
    const failed: string[] = [];
    for (const [i, file] of files.entries()) {
      const label = files.length > 1 ? `${i + 1} of ${files.length}: ` : '';
      try {
        setStatus(`${label}Preparing…`);
        await readImageSize(file);
        const display = await renderImage(file, null, MAX_ARTICLE_IMAGE);
        const source = await renderImage(file, null, MAX_SOURCE_IMAGE, 0.85);
        await savePhoto({
          display, source, crop: { x: 0, y: 0, w: 1, h: 1, aspect: 'original' }, alt: '',
          originalName: file.name.replace(/\.[a-z0-9]+$/i, ''),
          onProgress: (p) => setStatus(p.stage === 'saving' ? `${label}Saving…` : `${label}Uploading ${Math.round(p.fraction * 100)}%`),
        });
        done += 1;
      } catch (err) {
        failed.push(`${file.name}: ${err instanceof Error ? err.message : 'failed'}`);
      }
    }
    busy.current = false;
    setStatus(`${done} picture${done === 1 ? '' : 's'} added. They stay private until you use them on a page players can read.`);
    if (failed.length) setError(failed.join(' · '));
    data.reload();
  }

  function drop(e: DragEvent) {
    e.preventDefault();
    setOver(false);
    void upload(e.dataTransfer.files);
  }

  const words = q.toLowerCase().trim();
  const shown = (data.data?.items ?? []).filter((m) => {
    const uses = data.data?.usage.get(m.id) ?? [];
    if (filter === 'unused' && uses.length) return false;
    if (filter === 'players' && m.visibility !== 'players') return false;
    return !words || `${m.alt} ${m.original_name} ${m.credit}`.toLowerCase().includes(words);
  });

  return (
    <div className="media-library">
      <h1 className="page-title">Media library</h1>
      <p className="fine-print">
        Every picture you have uploaded. A picture is private (DM only) until it is used on something players can read: the main
        picture or text of a published, player-visible page, a published map, or the main-page banner. To add a picture to a page,
        open the page’s editor and use <strong>Add photo</strong>.
      </p>
      <div
        className={over ? 'drop-zone drop-over' : 'drop-zone'}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
      >
        <p className="drop-desktop">Drop photos here, or</p>
        <label className="button">
          Choose from device
          <input type="file" accept={IMAGE_TYPES} multiple hidden data-testid="library-file-input" onChange={(e) => { void upload(e.target.files); e.target.value = ''; }} />
        </label>
      </div>
      {status && <p className="form-ok" role="status">{status}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {data.error && <p className="form-error">{data.error}</p>}
      <div className="row-wrap media-filters">
        <input type="search" aria-label="Search pictures" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        {(['all', 'unused', 'players'] as const).map((f) => (
          <button key={f} type="button" className={filter === f ? 'chip chip-on' : 'chip'} aria-pressed={filter === f} onClick={() => setFilter(f)}>
            {f === 'all' ? 'All' : f === 'unused' ? 'Not used' : 'Players can see'}
          </button>
        ))}
      </div>
      {!data.data && !data.error && <p className="muted">Loading…</p>}
      {data.data && data.data.items.length === 0 && <p className="muted">No pictures yet.</p>}
      <ul className="media-cards">
        {shown.map((m) => (
          <MediaCard key={m.id} item={m} uses={data.data?.usage.get(m.id) ?? []} onChanged={data.reload} />
        ))}
      </ul>
    </div>
  );
}

function MediaCard({ item, uses, onChanged }: { item: MediaItem; uses: MediaUse[]; onChanged(): void }) {
  const [alt, setAlt] = useState(item.alt);
  const [credit, setCredit] = useState(item.credit);
  const [msg, setMsg] = useState<string | null>(null);
  const changed = alt !== item.alt || credit !== item.credit;
  return (
    <li className="media-card" aria-label={nameOf(item)}>
      <div className="media-card-art"><MediaImage path={item.path} alt={item.alt} /></div>
      <div className="media-card-body">
        <strong className="media-card-name">{nameOf(item)}</strong>
        <span className="fine-print">{item.width && item.height ? `${item.width} × ${item.height}` : ''} {kb(item.bytes)}</span>
        <span className={item.visibility === 'players' ? 'badge badge-ok' : 'badge badge-dm'}>{item.visibility === 'players' ? 'Players can see' : 'DM only'}</span>
        {uses.length ? (
          <ul className="media-uses">
            {uses.map((u) => <li key={u.label}><Link to={u.to}>{u.label}</Link></li>)}
          </ul>
        ) : <span className="fine-print">Not used on any page.</span>}
        <label>Description for screen readers<input value={alt} maxLength={300} onChange={(e) => setAlt(e.target.value)} /></label>
        <label>Artist or source (private)<input value={credit} maxLength={200} onChange={(e) => setCredit(e.target.value)} /></label>
        <div className="row-wrap">
          <button type="button" className="button small" disabled={!changed} onClick={async () => {
            try {
              await updateMedia(item.id, { alt, credit });
              setMsg('Saved.');
              onChanged();
            } catch (err) {
              setMsg(err instanceof Error ? err.message : 'Could not save.');
            }
          }}>Save details</button>
          <button
            type="button"
            className="button secondary small"
            disabled={uses.length > 0}
            title={uses.length ? 'In use: remove it from those pages first' : undefined}
            onClick={async () => {
              if (!window.confirm(`Delete “${nameOf(item)}” from the library? This cannot be undone.`)) return;
              try {
                await deleteMedia(item);
                onChanged();
              } catch (err) {
                setMsg(err instanceof Error ? err.message : 'Could not delete.');
              }
            }}
          >
            Delete
          </button>
        </div>
        {uses.length > 0 && <span className="fine-print">In use, so it cannot be deleted.</span>}
        {msg && <span className="fine-print" role="status">{msg}</span>}
      </div>
    </li>
  );
}
