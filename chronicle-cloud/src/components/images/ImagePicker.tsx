import '../../styles/images.css';
import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { downloadMedia, listMedia, mediaUrlForPath, mediaUrls, savePhoto, type MediaItem } from '../../lib/api.ts';
import { IMAGE_TYPES, MAX_ARTICLE_IMAGE, MAX_SOURCE_IMAGE, readImageSize, renderImage } from '../../lib/image.ts';
import type { Media } from '../../lib/types.ts';
import { useLoad } from '../../lib/useLoad.ts';
import { MediaImage } from '../MediaImage.tsx';
import { Cropper } from './Cropper.tsx';
import { ASPECTS, CENTRED, cropFractions, cropFromView, isWholePicture, viewFromCrop, type AspectKey, type View } from './crop.ts';

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

type Status = 'ready' | 'saving' | 'saved' | 'failed';

interface Item {
  key: string;
  file?: File;
  library?: MediaItem;
  /** What the cropper shows: the new file, the picture's private full-frame copy, or the picture itself. */
  url: string;
  width: number;
  height: number;
  /** Library pictures can be used unchanged; any other shape makes a new crop. */
  asIs: boolean;
  alt: string;
  caption: string;
  credit: string;
  aspect: AspectKey;
  view: View;
  status: Status;
  progress: string;
  error?: string;
  saved?: Media;
}

const FIRST_ASPECT: Record<Purpose, AspectKey> = { portrait: 'portrait', landscape: 'landscape', banner: 'banner', picture: 'original', gallery: 'original' };
const ASPECT_CHOICES: Record<Purpose, AspectKey[]> = {
  portrait: ['portrait', 'square', 'landscape', 'original'],
  landscape: ['landscape', 'portrait', 'square', 'original'],
  banner: ['banner', 'landscape', 'original'],
  picture: ['original', 'landscape', 'portrait', 'square'],
  gallery: ['original', 'landscape', 'portrait', 'square'],
};

const baseName = (name: string) => name.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').trim().slice(0, 200);
const message = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong.');

/**
 * Add Photo: Choose (from device or library) → Adjust → Save. `start` opens straight on Adjust
 * for a picture already in use, cropping again from its private full-frame copy.
 */
export function ImagePicker({ purpose, title, start, onCancel, onDone }: {
  purpose: Purpose;
  title: string;
  start?: MediaItem | null;
  onCancel(): void;
  onDone(picked: Picked[]): void;
}) {
  const multiple = purpose === 'gallery';
  const withCaption = purpose === 'picture' || purpose === 'gallery';
  const [step, setStep] = useState<'device' | 'library'>('device');
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const saving = useRef(false);
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
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && !saving.current && cancel.current();
    window.addEventListener('keydown', esc);
    const made = urls.current;
    return () => {
      window.removeEventListener('keydown', esc);
      made.forEach((u) => URL.revokeObjectURL(u));
      prev?.focus?.();
    };
  }, []);

  async function fromLibrary(chosen: MediaItem[], adjust: boolean) {
    setError(null);
    setBusy('Opening…');
    try {
      await mediaUrls(chosen.map((c) => c.id));
      const next: Item[] = [];
      for (const m of chosen) {
        // Crop from the private full-frame copy when there is one, so nothing is lost by cropping twice.
        const frame = m.source ?? { path: m.path, width: m.width, height: m.height };
        const url = (await mediaUrlForPath(frame.path)) ?? '';
        const width = frame.width ?? m.width ?? 1;
        const height = frame.height ?? m.height ?? 1;
        const savedAspect = m.crop && m.crop.aspect in ASPECTS ? (m.crop.aspect as AspectKey) : null;
        const aspect = savedAspect && ASPECT_CHOICES[purpose].includes(savedAspect) ? savedAspect : FIRST_ASPECT[purpose];
        next.push({
          key: m.id, library: m, url, width, height, asIs: !adjust,
          alt: m.alt, caption: '', credit: m.credit ?? '', aspect,
          view: m.crop && m.source && savedAspect === aspect ? viewFromCrop(m.crop, width, height, ASPECTS[aspect].ratio) : CENTRED,
          status: 'ready', progress: '',
        });
      }
      setItems(next);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(null);
    }
  }

  // "Adjust" for a picture in use skips the first step.
  const started = useRef(false);
  useEffect(() => {
    if (start && !started.current) {
      started.current = true;
      void fromLibrary([start], true);
    }
  });

  async function fromFiles(list: FileList | File[] | null) {
    const files = [...(list ?? [])].slice(0, multiple ? 24 : 1);
    if (files.length === 0) return;
    setError(null);
    setBusy('Opening…');
    const next: Item[] = [];
    const problems: string[] = [];
    for (const file of files) {
      try {
        const size = await readImageSize(file);
        const url = URL.createObjectURL(file);
        urls.current.push(url);
        next.push({
          key: url, file, url, ...size, asIs: false, alt: '', caption: '', credit: '',
          aspect: FIRST_ASPECT[purpose], view: CENTRED, status: 'ready', progress: '',
        });
      } catch (err) {
        problems.push(message(err));
      }
    }
    setBusy(null);
    if (problems.length) setError(problems.join(' '));
    if (next.length) setItems(next);
  }

  function drop(e: DragEvent) {
    e.preventDefault();
    setOver(false);
    void fromFiles(e.dataTransfer.files);
  }

  const patch = (key: string, p: Partial<Item>) => setItems((all) => all.map((it) => (it.key === key ? { ...it, ...p } : it)));

  async function saveOne(it: Item, label: string): Promise<Media> {
    if (it.library && it.asIs) return it.library;
    const ratio = ASPECTS[it.aspect].ratio;
    const show = (text: string) => patch(it.key, { progress: text });
    show(`${label}Preparing…`);
    const frame = it.file ?? (await downloadMedia(it.library!.source?.path ?? it.library!.path));
    const crop = isWholePicture(it.view, ratio) ? null : cropFromView(it.view, it.width, it.height, ratio);
    const display = await renderImage(frame, crop, purpose === 'banner' ? 2400 : MAX_ARTICLE_IMAGE);
    // A new photo, or an old picture that has no full-frame copy yet, gets one now.
    const source = it.library?.source ? { id: it.library.source.id } : await renderImage(frame, null, MAX_SOURCE_IMAGE, 0.85);
    return savePhoto({
      display, source,
      crop: { ...(crop ? cropFractions(crop, it.width, it.height) : { x: 0, y: 0, w: 1, h: 1 }), aspect: it.aspect },
      alt: it.alt, credit: it.credit,
      originalName: it.file ? baseName(it.file.name) : it.library!.original_name || it.library!.alt,
      onProgress: (p) => show(p.stage === 'saving' ? `${label}Saving…` : `${label}Uploading ${Math.round(p.fraction * 100)}%`),
    });
  }

  async function save() {
    if (saving.current) return; // one save at a time, however often the button is pressed
    saving.current = true;
    setError(null);
    const todo = items.filter((it) => it.status !== 'saved');
    const results = new Map<string, Media>();
    let failed = 0;
    for (const [i, it] of todo.entries()) {
      const label = items.length > 1 ? `${items.indexOf(it) + 1} of ${items.length}: ` : '';
      setBusy(`Saving ${i + 1} of ${todo.length}…`);
      patch(it.key, { status: 'saving', error: undefined });
      try {
        const media = await saveOne(it, label);
        results.set(it.key, media);
        patch(it.key, { status: 'saved', saved: media, progress: 'Saved' });
      } catch (err) {
        failed += 1;
        patch(it.key, { status: 'failed', progress: '', error: message(err) });
      }
    }
    saving.current = false;
    setBusy(null);
    if (failed === 0) {
      const all = items.map((it) => ({ it, media: results.get(it.key) ?? it.saved! }));
      onDone(all.map(({ it, media }) => ({ media, alt: it.alt, caption: it.caption })));
    } else {
      setError(failed === todo.length ? 'Nothing was saved. Check the message under the photo and try again.' : `${failed} of ${items.length} photos could not be saved. The others are safe in your library.`);
    }
  }

  const adjusting = items.length > 0;
  const saved = items.filter((it) => it.status === 'saved');
  const failedItems = items.filter((it) => it.status === 'failed');
  const isSaving = busy?.startsWith('Saving') ?? false;
  return (
    <>
      <div className="image-backdrop" onClick={isSaving ? undefined : onCancel} />
      <div ref={dialog} className="dialog image-dialog" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
        <div className="image-dialog-head">
          <h2>{title}</h2>
          <ol className="image-steps" aria-label="Steps">
            <li className={adjusting ? '' : 'on'}>1. Choose</li>
            <li className={adjusting && !isSaving ? 'on' : ''}>2. Adjust</li>
            <li className={isSaving ? 'on' : ''}>3. Save</li>
          </ol>
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}

        {!adjusting && (
          <>
            <div className="image-sources" role="group" aria-label="Where from">
              <button type="button" className={step === 'device' ? 'button' : 'button secondary'} aria-pressed={step === 'device'} onClick={() => { setStep('device'); input.current?.click(); }} disabled={!!busy}>
                Choose from device
              </button>
              <button type="button" className={step === 'library' ? 'button' : 'button secondary'} aria-pressed={step === 'library'} onClick={() => setStep('library')} disabled={!!busy}>
                Choose from library
              </button>
            </div>
            <input
              ref={input}
              type="file"
              accept={IMAGE_TYPES}
              multiple={multiple}
              hidden
              data-testid="image-file-input"
              onChange={(e) => { void fromFiles(e.target.files); e.target.value = ''; }}
            />
            {step === 'device' ? (
              <div
                className={over ? 'drop-zone drop-over' : 'drop-zone'}
                onDragOver={(e) => { e.preventDefault(); setOver(true); }}
                onDragLeave={() => setOver(false)}
                onDrop={drop}
                data-testid="drop-zone"
              >
                <p className="drop-desktop">Drop {multiple ? 'photos' : 'a photo'} here</p>
                <p className="fine-print">JPEG, PNG, WebP or iPhone photos. They are resized before upload and stay private until you use them on a page players can read.</p>
                {busy && <p className="muted" role="status">{busy}</p>}
              </div>
            ) : (
              <LibraryGrid multiple={multiple} onChoose={(chosen) => void fromLibrary(chosen, false)} />
            )}
          </>
        )}

        {adjusting && items.length === 1 && (
          <ItemForm item={items[0]!} withCaption={withCaption} onChange={(p) => patch(items[0]!.key, p)}>
            <Adjuster item={items[0]!} purpose={purpose} onChange={(p) => patch(items[0]!.key, p)} />
          </ItemForm>
        )}
        {adjusting && items.length > 1 && (
          <div className="image-batch">
            {items.map((it, i) => (
              <ItemForm key={it.key} item={it} withCaption={withCaption} onChange={(p) => patch(it.key, p)}>
                <div className="image-batch-thumb">
                  <img src={it.url} alt="" />
                  {it.status === 'ready' && !isSaving && (
                    <button type="button" className="icon-button" aria-label={`Leave out photo ${i + 1}`} onClick={() => setItems((all) => all.filter((x) => x.key !== it.key))}>✕</button>
                  )}
                </div>
              </ItemForm>
            ))}
          </div>
        )}

        <div className="form-actions image-actions">
          {adjusting && !start && saved.length === 0 && <button type="button" className="button secondary" disabled={!!busy} onClick={() => setItems([])}>Back</button>}
          <button type="button" className="button secondary" disabled={isSaving} onClick={onCancel}>Cancel</button>
          {adjusting && failedItems.length > 0 && saved.length > 0 && !isSaving && (
            <button type="button" className="button secondary" onClick={() => onDone(saved.map((it) => ({ media: it.saved!, alt: it.alt, caption: it.caption })))}>
              Use the {saved.length} saved
            </button>
          )}
          {adjusting && (
            <button type="button" className="button" disabled={!!busy} onClick={() => void save()}>
              {busy ?? (failedItems.length ? 'Try again' : items.length > 1 ? `Save ${items.length} photos` : 'Save')}
            </button>
          )}
        </div>
      </div>
    </>
  );
}

function Adjuster({ item, purpose, onChange }: { item: Item; purpose: Purpose; onChange(p: Partial<Item>): void }) {
  const choices = ASPECT_CHOICES[purpose];
  return (
    <div className="adjuster">
      {item.library && (
        <div className="cropper-aspects" role="group" aria-label="Use">
          <button type="button" className={item.asIs ? 'chip chip-on' : 'chip'} aria-pressed={item.asIs} onClick={() => onChange({ asIs: true })}>Use as is</button>
          <button type="button" className={!item.asIs ? 'chip chip-on' : 'chip'} aria-pressed={!item.asIs} onClick={() => onChange({ asIs: false })}>Adjust</button>
        </div>
      )}
      {item.asIs ? (
        <div className="as-is-preview"><img src={item.url} alt="" /></div>
      ) : (
        <Cropper
          src={item.url}
          width={item.width}
          height={item.height}
          aspect={item.aspect}
          aspects={choices}
          onAspect={(aspect) => onChange({ aspect, view: CENTRED })}
          view={item.view}
          onView={(view) => onChange({ view })}
        />
      )}
      {item.progress && <p className="upload-progress" role="status">{item.progress}</p>}
      {item.error && <p className="form-error" role="alert">{item.error}</p>}
    </div>
  );
}

function ItemForm({ item, withCaption, onChange, children }: { item: Item; withCaption: boolean; onChange(p: Partial<Item>): void; children: ReactNode }) {
  const locked = item.status === 'saving' || item.status === 'saved';
  return (
    <div className={`image-item image-item-${item.status}`}>
      {children}
      <div className="image-item-fields">
        {withCaption && (
          <label>Caption (shown under the picture)<input value={item.caption} maxLength={300} disabled={item.status === 'saving'} onChange={(e) => onChange({ caption: e.target.value })} /></label>
        )}
        <label>
          Description for screen readers
          <input value={item.alt} maxLength={300} disabled={locked} placeholder="e.g. A red dragon over burning rooftops" onChange={(e) => onChange({ alt: e.target.value })} />
        </label>
        {!item.library && (
          <label>Artist or source (optional, private)<input value={item.credit} maxLength={200} disabled={locked} onChange={(e) => onChange({ credit: e.target.value })} /></label>
        )}
        {item.status !== 'ready' && (item.progress || item.error) && (
          <span className={item.status === 'failed' ? 'form-error' : 'upload-progress'} role="status">{item.error ?? item.progress}</span>
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
  if (lib.data.length === 0) return <p className="muted">Your library is empty. Choose a photo from this device instead.</p>;
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
        {shown.length === 0 && <p className="muted">No picture matches “{q}”.</p>}
      </div>
      {multiple && (
        <button type="button" className="button" disabled={chosen.length === 0} onClick={() => onChoose(lib.data!.filter((m) => chosen.includes(m.id)))}>
          Use {chosen.length || ''} selected
        </button>
      )}
    </div>
  );
}
