import '../../styles/images.css';
import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { downloadMedia, listMedia, mediaUrls, uploadMedia, type MediaItem } from '../../lib/api.ts';
import { checkImageType, IMAGE_TYPES, MAX_ARTICLE_IMAGE, renderImage } from '../../lib/image.ts';
import type { Media } from '../../lib/types.ts';
import { useLoad } from '../../lib/useLoad.ts';
import { MediaImage } from '../MediaImage.tsx';
import { Cropper } from './Cropper.tsx';
import { ASPECTS, CENTRED, cropFromView, isWholePicture, type AspectKey, type View } from './crop.ts';

/**
 * portrait/landscape/banner: one picture for a page, banner or story, with cropping.
 * picture: one picture placed in text, with caption. gallery: several pictures side by side.
 */
export type Purpose = 'portrait' | 'landscape' | 'banner' | 'picture' | 'gallery';

export interface Picked {
  media: Media;
  alt: string;
  caption: string;
}

interface Item {
  key: string;
  file?: File;
  library?: MediaItem;
  url: string;
  width: number;
  height: number;
  alt: string;
  caption: string;
  credit: string;
  aspect: AspectKey;
  view: View;
}

const MAX: Record<Purpose, number> = { portrait: MAX_ARTICLE_IMAGE, landscape: MAX_ARTICLE_IMAGE, banner: 2400, picture: MAX_ARTICLE_IMAGE, gallery: MAX_ARTICLE_IMAGE };
const FIRST_ASPECT: Record<Purpose, AspectKey> = { portrait: 'portrait', landscape: 'landscape', banner: 'banner', picture: 'original', gallery: 'original' };
const ASPECT_CHOICES: Record<Purpose, AspectKey[]> = {
  portrait: ['portrait', 'square', 'landscape', 'original'],
  landscape: ['landscape', 'portrait', 'square', 'original'],
  banner: ['banner', 'landscape', 'original'],
  picture: ['original', 'landscape', 'portrait', 'square'],
  gallery: ['original'],
};

const baseName = (name: string) => name.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').trim().slice(0, 200);

function measure(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('This file could not be opened as a picture.'));
    img.src = url;
  });
}

/** Upload → Adjust → Save. Opens on the upload step, or straight on Adjust for `start`. */
export function ImagePicker({ purpose, title, start, onCancel, onDone }: {
  purpose: Purpose;
  title: string;
  start?: MediaItem | null;
  onCancel(): void;
  onDone(picked: Picked[]): void;
}) {
  const multiple = purpose === 'gallery';
  const withCaption = purpose === 'picture' || purpose === 'gallery';
  const [tab, setTab] = useState<'upload' | 'library'>('upload');
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const urls = useRef<string[]>([]);
  const dialog = useRef<HTMLDivElement>(null);

  const cancel = useRef(onCancel);
  useEffect(() => {
    cancel.current = onCancel;
  });
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && cancel.current();
    window.addEventListener('keydown', esc);
    const made = urls.current;
    return () => {
      window.removeEventListener('keydown', esc);
      made.forEach((u) => URL.revokeObjectURL(u));
      prev?.focus?.();
    };
  }, []);

  async function fromLibrary(chosen: MediaItem[]) {
    setError(null);
    setBusy('Opening…');
    try {
      const signed = await mediaUrls(chosen.map((c) => c.id));
      const next = chosen.map((m): Item => ({
        key: m.id, library: m, url: signed.get(m.id) ?? '', width: m.width ?? 1, height: m.height ?? 1,
        alt: m.alt, caption: '', credit: m.credit ?? '',
        // Re-using a library picture as it is never makes a copy; choose a shape to crop it.
        aspect: 'original', view: CENTRED,
      }));
      for (const it of next) {
        if (!it.library?.width || !it.library?.height) Object.assign(it, await measure(it.url));
      }
      setItems(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open that picture.');
    } finally {
      setBusy(null);
    }
  }

  // Opening "Adjust" for the current picture skips the first step.
  const started = useRef(false);
  useEffect(() => {
    if (start && !started.current) {
      started.current = true;
      void fromLibrary([start]);
    }
  });

  async function fromFiles(list: FileList | File[] | null) {
    const files = [...(list ?? [])].slice(0, multiple ? 24 : 1);
    if (files.length === 0) return;
    setError(null);
    setBusy('Opening…');
    try {
      const next: Item[] = [];
      for (const file of files) {
        checkImageType(file);
        const url = URL.createObjectURL(file);
        urls.current.push(url);
        const size = await measure(url);
        next.push({
          key: url, file, url, ...size, alt: '', caption: '', credit: '',
          aspect: FIRST_ASPECT[purpose], view: CENTRED,
        });
      }
      setItems(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open that picture.');
    } finally {
      setBusy(null);
    }
  }

  function drop(e: DragEvent) {
    e.preventDefault();
    setOver(false);
    void fromFiles(e.dataTransfer.files);
  }

  const patch = (i: number, p: Partial<Item>) => setItems((all) => all.map((it, j) => (j === i ? { ...it, ...p } : it)));

  async function save() {
    setError(null);
    const out: Picked[] = [];
    try {
      for (const [i, it] of items.entries()) {
        setBusy(items.length > 1 ? `Saving ${i + 1} of ${items.length}…` : 'Saving…');
        const ratio = ASPECTS[it.aspect].ratio;
        if (it.library && isWholePicture(it.view, ratio)) {
          out.push({ media: it.library, alt: it.alt, caption: it.caption });
          continue;
        }
        // A new, smaller copy: the original upload or library file is never changed.
        const source = it.file ?? (await downloadMedia(it.library!.path));
        const crop = isWholePicture(it.view, ratio) ? null : cropFromView(it.view, it.width, it.height, ratio);
        const prepared = await renderImage(source, crop, MAX[purpose]);
        const media = await uploadMedia(prepared.blob, {
          alt: it.alt, width: prepared.width, height: prepared.height, credit: it.credit,
          originalName: it.file ? baseName(it.file.name) : it.library!.original_name || it.library!.alt,
        });
        out.push({ media, alt: it.alt, caption: it.caption });
      }
      onDone(out);
    } catch (err) {
      setError(err instanceof Error ? `${err.message} Nothing was changed on the page.` : 'Saving failed. Nothing was changed on the page.');
      setBusy(null);
    }
  }

  const adjusting = items.length > 0;
  return (
    <>
      <div className="image-backdrop" onClick={busy ? undefined : onCancel} />
      <div ref={dialog} className="dialog image-dialog" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
        <div className="image-dialog-head">
          <h2>{title}</h2>
          <ol className="image-steps" aria-label="Steps">
            <li className={adjusting ? '' : 'on'}>1. Choose</li>
            <li className={adjusting && !busy?.startsWith('Saving') ? 'on' : ''}>2. Adjust</li>
            <li className={busy?.startsWith('Saving') ? 'on' : ''}>3. Save</li>
          </ol>
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}

        {!adjusting && (
          <>
            <div className="image-tabs" role="tablist">
              <button type="button" role="tab" aria-selected={tab === 'upload'} className={tab === 'upload' ? 'chip chip-on' : 'chip'} onClick={() => setTab('upload')}>Upload</button>
              <button type="button" role="tab" aria-selected={tab === 'library'} className={tab === 'library' ? 'chip chip-on' : 'chip'} onClick={() => setTab('library')}>Media library</button>
            </div>
            {tab === 'upload' ? (
              <div
                className={over ? 'drop-zone drop-over' : 'drop-zone'}
                onDragOver={(e) => { e.preventDefault(); setOver(true); }}
                onDragLeave={() => setOver(false)}
                onDrop={drop}
              >
                <p className="drop-desktop">Drag {multiple ? 'pictures' : 'a picture'} here, or</p>
                <button type="button" className="button" onClick={() => input.current?.click()} disabled={!!busy}>
                  {multiple ? 'Choose pictures' : 'Choose a picture'} from this device
                </button>
                <input
                  ref={input}
                  type="file"
                  accept={IMAGE_TYPES}
                  multiple={multiple}
                  hidden
                  data-testid="image-file-input"
                  onChange={(e) => { void fromFiles(e.target.files); e.target.value = ''; }}
                />
                <p className="fine-print">PNG, JPEG, WebP or GIF. Pictures are resized and compressed before upload, and stay private until you use them on a page players can read.</p>
              </div>
            ) : (
              <LibraryGrid multiple={multiple} onChoose={(chosen) => void fromLibrary(chosen)} />
            )}
          </>
        )}

        {adjusting && items.length === 1 && (
          <ItemForm item={items[0]!} withCaption={withCaption} onChange={(p) => patch(0, p)}>
            {purpose !== 'gallery' && (
              <Cropper
                src={items[0]!.url}
                width={items[0]!.width}
                height={items[0]!.height}
                aspect={items[0]!.aspect}
                aspects={items[0]!.library ? ['original', ...ASPECT_CHOICES[purpose].filter((a) => a !== 'original')] : ASPECT_CHOICES[purpose]}
                onAspect={(aspect) => patch(0, { aspect, view: CENTRED })}
                view={items[0]!.view}
                onView={(view) => patch(0, { view })}
              />
            )}
          </ItemForm>
        )}
        {adjusting && items.length > 1 && (
          <div className="image-batch">
            {items.map((it, i) => (
              <ItemForm key={it.key} item={it} withCaption={withCaption} onChange={(p) => patch(i, p)}>
                <div className="image-batch-thumb">
                  <img src={it.url} alt="" />
                  <button type="button" className="icon-button" aria-label={`Leave out picture ${i + 1}`} onClick={() => setItems((all) => all.filter((_, j) => j !== i))}>✕</button>
                </div>
              </ItemForm>
            ))}
          </div>
        )}

        <div className="form-actions image-actions">
          {adjusting && !start && <button type="button" className="button secondary" disabled={!!busy} onClick={() => setItems([])}>Back</button>}
          <button type="button" className="button secondary" disabled={!!busy && busy.startsWith('Saving')} onClick={onCancel}>Cancel</button>
          {adjusting && (
            <button type="button" className="button" disabled={!!busy} onClick={() => void save()}>
              {busy ?? (items.length > 1 ? `Save ${items.length} pictures` : 'Save picture')}
            </button>
          )}
          {!adjusting && busy && <span className="muted" role="status">{busy}</span>}
        </div>
      </div>
    </>
  );
}

function ItemForm({ item, withCaption, onChange, children }: { item: Item; withCaption: boolean; onChange(p: Partial<Item>): void; children: ReactNode }) {
  return (
    <div className="image-item">
      {children}
      <div className="image-item-fields">
        {withCaption && (
          <label>Caption (shown under the picture)<input value={item.caption} maxLength={300} onChange={(e) => onChange({ caption: e.target.value })} /></label>
        )}
        <label>
          Description for screen readers
          <input value={item.alt} maxLength={300} placeholder="e.g. A red dragon over burning rooftops" onChange={(e) => onChange({ alt: e.target.value })} />
        </label>
        {!item.library && (
          <label>Artist or source (optional, private)<input value={item.credit} maxLength={200} onChange={(e) => onChange({ credit: e.target.value })} /></label>
        )}
      </div>
    </div>
  );
}

function LibraryGrid({ multiple, onChoose }: { multiple: boolean; onChoose(items: MediaItem[]): void }) {
  const lib = useLoad(async () => {
    const all = await listMedia();
    await mediaUrls(all.slice(0, 200).map((m) => m.id)); // one request signs the first page of thumbnails
    return all;
  }, []);
  const [q, setQ] = useState('');
  const [chosen, setChosen] = useState<string[]>([]);
  if (lib.error) return <p className="form-error">{lib.error}</p>;
  if (!lib.data) return <p className="muted">Loading your pictures…</p>;
  const words = q.toLowerCase().trim();
  const shown = lib.data.filter((m) => !words || `${m.alt} ${m.original_name} ${m.credit}`.toLowerCase().includes(words));
  if (lib.data.length === 0) return <p className="muted">Your media library is empty. Upload a picture instead.</p>;
  return (
    <div className="library-pick">
      <input type="search" aria-label="Search pictures" placeholder="Search by description or file name" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="library-grid">
        {shown.map((m) => {
          const on = chosen.includes(m.id);
          return (
            <button
              key={m.id}
              type="button"
              className={on ? 'library-tile on' : 'library-tile'}
              aria-pressed={multiple ? on : undefined}
              aria-label={m.alt || m.original_name || 'Untitled picture'}
              onClick={() => (multiple ? setChosen((c) => (on ? c.filter((x) => x !== m.id) : [...c, m.id])) : onChoose([m]))}
            >
              <MediaImage path={m.path} alt="" />
              <span>{m.alt || m.original_name || 'Untitled'}</span>
            </button>
          );
        })}
      </div>
      {multiple && (
        <button type="button" className="button" disabled={chosen.length === 0} onClick={() => onChoose(lib.data!.filter((m) => chosen.includes(m.id)))}>
          Use {chosen.length || ''} selected
        </button>
      )}
    </div>
  );
}
