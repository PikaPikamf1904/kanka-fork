import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useBlocker, useNavigate, useParams, useSearchParams } from 'react-router';
import { StatusBadge, VisibilityBadge } from '../../components/Badges.tsx';
import { Markdown } from '../../components/Markdown.tsx';
import { MediaImage } from '../../components/MediaImage.tsx';
import {
  addRedirect, addRelation, createCategory, deleteArticle, deleteNote, deleteRedirect, deleteRelation,
  getArticleForEdit, listAllArticleRefs, listCategories, restoreRevision, saveArticle, saveNote, uploadMedia,
  type ArticleDraft,
} from '../../lib/api.ts';
import { prepareImage } from '../../lib/image.ts';
import { slugify, wikiLinkTargets } from '../../lib/slug.ts';
import { RELATION_KINDS, relationLabel, TEMPLATES, TYPE_ORDER } from '../../lib/templates.ts';
import type { ArticleType, PublishStatus, Visibility } from '../../lib/types.ts';
import { useLoad } from '../../lib/useLoad.ts';

function blankDraft(type: ArticleType): ArticleDraft {
  const t = TEMPLATES[type];
  return {
    article: {
      slug: '', type, title: '', subtitle: '', summary: '', hero_media_id: null,
      visibility: t.defaultVisibility, status: 'draft', is_featured: false, is_party_member: false, importance: 0, session_date: null,
    },
    sections: t.sections.map((s, i) => ({ position: i + 1, heading: s.heading, body: '', visibility: s.visibility ?? 'players', status: 'draft' })),
    infobox: t.infobox.map((f, i) => ({ position: i + 1, label: f.label, value: '', visibility: f.visibility ?? 'players' })),
    categoryIds: [],
  };
}

function VisibilitySelect({ value, onChange, label }: { value: Visibility; onChange(v: Visibility): void; label: string }) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value as Visibility)} className={value === 'dm' ? 'select-dm' : undefined}>
      <option value="players">Players</option>
      <option value="dm">DM only</option>
    </select>
  );
}

function StatusSelect({ value, onChange, label }: { value: PublishStatus; onChange(v: PublishStatus): void; label: string }) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value as PublishStatus)}>
      <option value="draft">Draft</option>
      <option value="published">Published</option>
    </select>
  );
}

export function ArticleEditor() {
  const { slug } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const initialType = (TYPE_ORDER as string[]).includes(params.get('type') ?? '') ? (params.get('type') as ArticleType) : 'lore';

  const existing = useLoad(() => (slug ? getArticleForEdit(slug) : Promise.resolve(null)), [slug]);
  const categories = useLoad(listCategories, []);
  const allArticles = useLoad(listAllArticleRefs, []);

  const [draft, setDraft] = useState<ArticleDraft>(() => blankDraft(initialType));
  const [dirty, setDirty] = useState(false);
  const [slugTouched, setSlugTouched] = useState(Boolean(slug));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<number | null>(null);

  const [loadedFrom, setLoadedFrom] = useState<unknown>(null);
  if (existing.data && existing.data !== loadedFrom) {
    const e = existing.data;
    setLoadedFrom(e);
    const { id, slug: s, type, title, subtitle, summary, hero_media_id, visibility, status, is_featured, is_party_member, importance, session_date } = e.article;
    setDraft({
      article: { id, slug: s, type, title, subtitle, summary, hero_media_id, visibility, status, is_featured, is_party_member, importance, session_date },
      sections: e.sections.map(({ id: sid, position, heading, body, visibility: v, status: st }) => ({ id: sid, position, heading, body, visibility: v, status: st })),
      infobox: e.infobox.map(({ id: fid, position, label, value, visibility: v }) => ({ id: fid, position, label, value, visibility: v })),
      categoryIds: e.categories.map((c) => c.id),
    });
    setDirty(false);
  }

  // Warn before leaving with unsaved changes (in-app navigation and tab close).
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && !saving && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (blocker.state === 'blocked') {
      if (window.confirm('You have unsaved changes. Leave without saving?')) blocker.proceed();
      else blocker.reset();
    }
  }, [blocker]);
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [dirty]);

  const update = (patch: Partial<ArticleDraft['article']>) => {
    setDirty(true);
    setDraft((d) => {
      const article = { ...d.article, ...patch };
      if (patch.title !== undefined && !slugTouched) article.slug = slugify(patch.title);
      return { ...d, article };
    });
  };
  const updateSection = (i: number, patch: Partial<ArticleDraft['sections'][number]>) => {
    setDirty(true);
    setDraft((d) => ({ ...d, sections: d.sections.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
  };
  const updateField = (i: number, patch: Partial<ArticleDraft['infobox'][number]>) => {
    setDirty(true);
    setDraft((d) => ({ ...d, infobox: d.infobox.map((f, j) => (j === i ? { ...f, ...patch } : f)) }));
  };
  function move<T>(list: T[], i: number, by: number): T[] {
    const j = i + by;
    if (j < 0 || j >= list.length) return list;
    const copy = [...list];
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
    return copy;
  }

  const unknownLinks = useMemo(() => {
    const known = new Set((allArticles.data ?? []).map((a) => a.slug));
    const targets = new Set(draft.sections.flatMap((s) => wikiLinkTargets(s.body)));
    return [...targets].filter((t) => !known.has(t));
  }, [draft.sections, allArticles.data]);

  // A link's text and address are visible wherever the section is, so warn when player-visible
  // text points at a page players cannot see.
  const hiddenLinks = useMemo(() => {
    const hidden = new Set((allArticles.data ?? []).filter((a) => a.visibility !== 'players' || a.status !== 'published').map((a) => a.slug));
    const fromPlayerText = draft.sections
      .filter((s) => s.visibility === 'players' && s.status === 'published')
      .flatMap((s) => wikiLinkTargets(s.body))
      .concat(draft.infobox.filter((f) => f.visibility === 'players').flatMap((f) => wikiLinkTargets(f.value)));
    return [...new Set(fromPlayerText.filter((t) => hidden.has(t)))];
  }, [draft.sections, draft.infobox, allArticles.data]);

  async function save(e?: FormEvent) {
    e?.preventDefault();
    setError(null);
    setMessage(null);
    if (!draft.article.title.trim() || !draft.article.slug) {
      setError('A title is required.');
      return;
    }
    const wasPublic = existing.data?.article.status === 'published' && existing.data.article.visibility === 'players';
    const nowPublic = draft.article.status === 'published' && draft.article.visibility === 'players';
    if (wasPublic && !nowPublic && !window.confirm('This hides the article from players. Continue?')) return;
    setSaving(true);
    try {
      const saved = await saveArticle(draft, 'Before save');
      setDirty(false);
      setMessage('Saved.');
      if (!slug || saved.slug !== slug) navigate(`/dm/edit/${saved.slug}`, { replace: true });
      else existing.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  }

  async function onHeroFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      const prepared = await prepareImage(file);
      const visibility = draft.article.visibility === 'players' ? 'players' : 'dm';
      const media = await uploadMedia(prepared.blob, { alt: draft.article.title, width: prepared.width, height: prepared.height, visibility });
      update({ hero_media_id: media.id });
      setMessage(`Image uploaded (${Math.round(prepared.blob.size / 1024)} KB, visible to ${visibility === 'players' ? 'players' : 'the DM only'}).`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.');
    }
  }

  const e = existing.data;
  const t = TEMPLATES[draft.article.type];
  const articleId = draft.article.id;

  return (
    <form className="editor" onSubmit={save}>
      <div className="editor-head">
        <div>
          <p className="muted"><Link to="/dm">DM desk</Link> › {slug ? 'Edit' : 'New'} {t.label.toLowerCase()}</p>
          <h1 className="page-title">{draft.article.title || `New ${t.label.toLowerCase()}`}</h1>
          <div className="badges-row">
            <StatusBadge status={draft.article.status} />
            <VisibilityBadge visibility={draft.article.visibility} />
            {dirty && <span className="badge badge-draft">Unsaved changes</span>}
          </div>
        </div>
        <div className="editor-actions">
          {slug && <Link className="button secondary" to={`/wiki/${slug}`}>View</Link>}
          <button type="submit" className="button" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {message && <p className="form-ok" role="status">{message}</p>}

      <section className="panel form-grid">
        <h2>Basics</h2>
        <label>Title<input value={draft.article.title} onChange={(ev) => update({ title: ev.target.value })} required maxLength={200} /></label>
        <label>
          Address (slug)
          <input
            value={draft.article.slug}
            onChange={(ev) => {
              setSlugTouched(true);
              update({ slug: slugify(ev.target.value) });
            }}
            required
          />
          <span className="fine-print">/wiki/{draft.article.slug || '…'}{slug && draft.article.slug !== slug && ' · add a redirect below so old links keep working'}</span>
        </label>
        <label>
          Type
          <select
            value={draft.article.type}
            onChange={(ev) => {
              const type = ev.target.value as ArticleType;
              if (!slug && draft.sections.every((s) => !s.body) && draft.infobox.every((f) => !f.value)) {
                const fresh = blankDraft(type);
                setDraft((d) => ({ ...fresh, article: { ...fresh.article, title: d.article.title, slug: d.article.slug } }));
                setDirty(true);
              } else update({ type });
            }}
          >
            {TYPE_ORDER.map((ty) => <option key={ty} value={ty}>{TEMPLATES[ty].label}</option>)}
          </select>
        </label>
        <label>Subtitle<input value={draft.article.subtitle} onChange={(ev) => update({ subtitle: ev.target.value })} maxLength={200} /></label>
        <label className="span-2">
          Summary (shown to players at the top of the page and on cards)
          <textarea rows={3} value={draft.article.summary} onChange={(ev) => update({ summary: ev.target.value })} />
        </label>
        <div className="span-2 row-wrap">
          <label>Who can see this article<VisibilitySelect label="Article visibility" value={draft.article.visibility} onChange={(v) => update({ visibility: v })} /></label>
          <label>Status<StatusSelect label="Article status" value={draft.article.status} onChange={(v) => update({ status: v })} /></label>
          <label className="checkbox"><input type="checkbox" checked={draft.article.is_featured} onChange={(ev) => update({ is_featured: ev.target.checked })} /> Featured on the main page</label>
          {draft.article.type === 'character' && (
            <label className="checkbox"><input type="checkbox" checked={draft.article.is_party_member} onChange={(ev) => update({ is_party_member: ev.target.checked })} /> Party member</label>
          )}
          <label>Importance<input type="number" min={0} max={100} value={draft.article.importance} onChange={(ev) => update({ importance: Number(ev.target.value) || 0 })} /></label>
          {draft.article.type === 'session' && (
            <label>Session date<input type="date" value={draft.article.session_date ?? ''} onChange={(ev) => update({ session_date: ev.target.value || null })} /></label>
          )}
        </div>
        <p className="fine-print span-2">
          Players see this article only when it is <strong>Published</strong> and visible to <strong>Players</strong>. Each section and infobox
          row below has its own setting, so one article can hold both player lore and DM secrets.
        </p>
        <div className="span-2 hero-upload">
          {draft.article.hero_media_id && <MediaImage id={draft.article.hero_media_id} alt="" className="hero-thumb" />}
          <label>
            Main image (resized to 1600 px WebP before upload)
            <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(ev) => void onHeroFile(ev.target.files?.[0])} />
          </label>
          {draft.article.hero_media_id && <button type="button" className="button secondary small" onClick={() => update({ hero_media_id: null })}>Remove image</button>}
        </div>
      </section>

      <section className="panel">
        <h2>Infobox</h2>
        <div className="rows">
          {draft.infobox.map((f, i) => (
            <div key={f.id ?? `new-${i}`} className={f.visibility === 'dm' ? 'row dm-only' : 'row'}>
              <input aria-label="Field label" value={f.label} onChange={(ev) => updateField(i, { label: ev.target.value })} maxLength={80} placeholder="Label" />
              <input aria-label={`${f.label} value`} value={f.value} onChange={(ev) => updateField(i, { value: ev.target.value })} placeholder="Value ([[links]] work)" />
              <VisibilitySelect label={`${f.label} visibility`} value={f.visibility} onChange={(v) => updateField(i, { visibility: v })} />
              <button type="button" className="icon-button" aria-label="Move up" onClick={() => { setDirty(true); setDraft((d) => ({ ...d, infobox: move(d.infobox, i, -1) })); }}>↑</button>
              <button type="button" className="icon-button" aria-label="Move down" onClick={() => { setDirty(true); setDraft((d) => ({ ...d, infobox: move(d.infobox, i, 1) })); }}>↓</button>
              <button type="button" className="icon-button" aria-label={`Remove ${f.label}`} onClick={() => { setDirty(true); setDraft((d) => ({ ...d, infobox: d.infobox.filter((_, j) => j !== i) })); }}>✕</button>
            </div>
          ))}
        </div>
        <button type="button" className="button secondary small" onClick={() => { setDirty(true); setDraft((d) => ({ ...d, infobox: [...d.infobox, { position: d.infobox.length + 1, label: 'New field', value: '', visibility: 'dm' }] })); }}>
          Add field
        </button>
      </section>

      <section className="panel">
        <h2>Sections</h2>
        <p className="fine-print">Write in Markdown. Link to other pages with [[Page title]] or [[slug|shown text]]. Add an image with ![alt](media:path).</p>
        {draft.sections.map((s, i) => (
          <div key={s.id ?? `new-${i}`} className={s.visibility === 'dm' || s.status === 'draft' ? 'section-editor dm-only' : 'section-editor'}>
            <div className="row">
              <input aria-label="Section heading" className="grow" value={s.heading} onChange={(ev) => updateSection(i, { heading: ev.target.value })} placeholder="Heading" />
              <VisibilitySelect label={`${s.heading} visibility`} value={s.visibility} onChange={(v) => updateSection(i, { visibility: v })} />
              <StatusSelect label={`${s.heading} status`} value={s.status} onChange={(v) => updateSection(i, { status: v })} />
              <button type="button" className="icon-button" aria-label="Move up" onClick={() => { setDirty(true); setDraft((d) => ({ ...d, sections: move(d.sections, i, -1) })); }}>↑</button>
              <button type="button" className="icon-button" aria-label="Move down" onClick={() => { setDirty(true); setDraft((d) => ({ ...d, sections: move(d.sections, i, 1) })); }}>↓</button>
              <button type="button" className="icon-button" aria-label="Preview" onClick={() => setPreview(preview === i ? null : i)}>👁</button>
              <button
                type="button"
                className="icon-button"
                aria-label={`Remove section ${s.heading}`}
                onClick={() => {
                  if (!s.body.trim() || window.confirm(`Remove the section “${s.heading}”? It can be recovered from history after saving.`)) {
                    setDirty(true);
                    setDraft((d) => ({ ...d, sections: d.sections.filter((_, j) => j !== i) }));
                  }
                }}
              >
                ✕
              </button>
            </div>
            <textarea aria-label={`${s.heading} text`} rows={6} value={s.body} onChange={(ev) => updateSection(i, { body: ev.target.value })} />
            {preview === i && <div className="section-preview"><Markdown text={s.body} /></div>}
          </div>
        ))}
        {unknownLinks.length > 0 && <p className="fine-print">Links to pages that don’t exist yet: {unknownLinks.join(', ')}</p>}
        {hiddenLinks.length > 0 && (
          <p className="form-error" role="alert">
            Player-visible text links to pages players cannot see: {hiddenLinks.join(', ')}. Players will see the link text and address.
          </p>
        )}
        <div className="row-wrap">
          <button type="button" className="button secondary small" onClick={() => { setDirty(true); setDraft((d) => ({ ...d, sections: [...d.sections, { position: d.sections.length + 1, heading: 'New section', body: '', visibility: 'players', status: 'draft' }] })); }}>
            Add player section
          </button>
          <button type="button" className="button secondary small" onClick={() => { setDirty(true); setDraft((d) => ({ ...d, sections: [...d.sections, { position: d.sections.length + 1, heading: 'DM secrets', body: '', visibility: 'dm', status: 'draft' }] })); }}>
            Add DM-only section
          </button>
        </div>
      </section>

      <CategoryPicker
        selected={draft.categoryIds}
        categories={categories.data ?? []}
        onChange={(ids) => { setDirty(true); setDraft((d) => ({ ...d, categoryIds: ids })); }}
        onCreated={() => categories.reload()}
      />

      <div className="editor-actions bottom">
        <button type="submit" className="button" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
      </div>

      {articleId && e && (
        <>
          <RelationsEditor
            articleId={articleId}
            relations={e.relations}
            articles={(allArticles.data ?? []).filter((a) => a.id !== articleId)}
            onChange={() => existing.reload()}
          />
          <NotesEditor articleId={articleId} notes={e.notes} onChange={() => existing.reload()} />
          <RedirectsEditor articleId={articleId} redirects={e.redirects} onChange={() => existing.reload()} />
          <section className="panel">
            <h2>History</h2>
            <p className="fine-print">Every save keeps a copy of the article as it was before. Restoring also keeps a copy first.</p>
            {e.revisions.length === 0 && <p className="muted">No earlier versions yet.</p>}
            <ul className="revision-list">
              {e.revisions.map((r) => (
                <li key={r.id}>
                  {new Date(r.created_at).toLocaleString()} <span className="muted">{r.note}</span>{' '}
                  <button
                    type="button"
                    className="link-button"
                    onClick={async () => {
                      if (window.confirm('Restore this version? The current version is kept in history first.')) {
                        await restoreRevision(r.id);
                        existing.reload();
                        setMessage('Restored.');
                      }
                    }}
                  >
                    Restore
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <section className="panel danger-zone">
            <h2>Delete article</h2>
            <p className="fine-print">Deleting removes the article, its sections, notes, history and redirects. Prefer unpublishing.</p>
            <button
              type="button"
              className="button danger"
              onClick={async () => {
                const typed = window.prompt(`Type the title “${draft.article.title}” to delete this article permanently.`);
                if (typed === draft.article.title) {
                  await deleteArticle(articleId);
                  setDirty(false);
                  navigate('/dm');
                }
              }}
            >
              Delete permanently
            </button>
          </section>
        </>
      )}
      {!articleId && <p className="fine-print">Connections, private notes, redirects and history become available after the first save.</p>}
    </form>
  );
}

function CategoryPicker({ selected, categories, onChange, onCreated }: {
  selected: string[];
  categories: { id: string; name: string; kind: string; visibility: Visibility }[];
  onChange(ids: string[]): void;
  onCreated(): void;
}) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'category' | 'tag'>('category');
  const [visibility, setVisibility] = useState<Visibility>('players');
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="panel">
      <h2>Categories and tags</h2>
      <div className="chip-cloud">
        {categories.map((c) => {
          const on = selected.includes(c.id);
          return (
            <button
              key={c.id}
              type="button"
              aria-pressed={on}
              className={`chip ${on ? 'chip-on' : ''} ${c.kind === 'tag' ? 'chip-tag' : ''}`}
              onClick={() => onChange(on ? selected.filter((id) => id !== c.id) : [...selected, c.id])}
            >
              {c.name}{c.visibility === 'dm' ? ' 🔒' : ''}
            </button>
          );
        })}
      </div>
      <div className="row-wrap">
        <input aria-label="New category name" placeholder="New category or tag" value={name} onChange={(e) => setName(e.target.value)} />
        <select aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value as 'category' | 'tag')}>
          <option value="category">Category</option>
          <option value="tag">Tag</option>
        </select>
        <VisibilitySelect label="New category visibility" value={visibility} onChange={setVisibility} />
        <button
          type="button"
          className="button secondary small"
          onClick={async () => {
            setError(null);
            try {
              const created = await createCategory({ name: name.trim(), slug: slugify(name), kind, visibility });
              setName('');
              onCreated();
              onChange([...selected, created.id]);
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Could not create it.');
            }
          }}
          disabled={!slugify(name)}
        >
          Create
        </button>
      </div>
      <p className="fine-print">A DM-only category is hidden from players, including its name and how many pages it has.</p>
      {error && <p className="form-error">{error}</p>}
    </section>
  );
}

function RelationsEditor({ articleId, relations, articles, onChange }: {
  articleId: string;
  relations: { id: string; kind: string; label: string; visibility: Visibility; direction: 'out' | 'in'; other: { slug: string; title: string } }[];
  articles: { id: string; title: string }[];
  onChange(): void;
}) {
  const [target, setTarget] = useState('');
  const [kind, setKind] = useState(RELATION_KINDS[0]!.kind);
  const [label, setLabel] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('dm');
  return (
    <section className="panel">
      <h2>Connections</h2>
      <ul className="relation-list">
        {relations.map((r) => (
          <li key={r.id} className={r.visibility === 'dm' ? 'dm-only' : undefined}>
            {r.direction === 'out' ? 'This' : r.other.title} <em>{relationLabel(r.kind)}</em> {r.direction === 'out' ? r.other.title : 'this'}
            {r.label && <span className="muted"> ({r.label})</span>} <VisibilityBadge visibility={r.visibility} />{' '}
            <button type="button" className="link-button" onClick={async () => { if (window.confirm('Remove this connection?')) { await deleteRelation(r.id); onChange(); } }}>Remove</button>
          </li>
        ))}
      </ul>
      <div className="row-wrap">
        <select aria-label="Kind of connection" value={kind} onChange={(e) => setKind(e.target.value)}>
          {RELATION_KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
        </select>
        <select aria-label="Connected article" value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">Choose a page…</option>
          {articles.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}
        </select>
        <input aria-label="Connection note" placeholder="Note (optional)" value={label} onChange={(e) => setLabel(e.target.value)} />
        <VisibilitySelect label="Connection visibility" value={visibility} onChange={setVisibility} />
        <button
          type="button"
          className="button secondary small"
          disabled={!target}
          onClick={async () => {
            await addRelation({ source_article_id: articleId, target_article_id: target, kind, label, visibility });
            setTarget('');
            setLabel('');
            onChange();
          }}
        >
          Add connection
        </button>
      </div>
      <p className="fine-print">Players see a connection only if it is visible to players and they can see both pages.</p>
    </section>
  );
}

function NotesEditor({ articleId, notes, onChange }: { articleId: string; notes: { id: string; title: string; body: string }[]; onChange(): void }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  return (
    <section className="panel dm-panel">
      <h2>Private DM notes <VisibilityBadge visibility="dm" /></h2>
      {notes.map((n) => (
        <details key={n.id} className="note">
          <summary>{n.title || 'Untitled note'}</summary>
          <Markdown text={n.body} />
          <button type="button" className="link-button" onClick={async () => { if (window.confirm('Delete this note?')) { await deleteNote(n.id); onChange(); } }}>Delete note</button>
        </details>
      ))}
      <div className="form-grid">
        <label>Title<input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <label className="span-2">Note<textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} /></label>
        <button type="button" className="button secondary small" disabled={!body.trim()} onClick={async () => { await saveNote({ article_id: articleId, title, body }); setTitle(''); setBody(''); onChange(); }}>Add note</button>
      </div>
    </section>
  );
}

function RedirectsEditor({ articleId, redirects, onChange }: { articleId: string; redirects: { from_slug: string; visibility: Visibility }[]; onChange(): void }) {
  const [from, setFrom] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('players');
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="panel">
      <h2>Redirects</h2>
      <p className="fine-print">Old addresses that should open this page. A DM-only redirect (for example a secret true name) never works for players.</p>
      <ul>
        {redirects.map((r) => (
          <li key={r.from_slug}>/wiki/{r.from_slug} <VisibilityBadge visibility={r.visibility} />{' '}
            <button type="button" className="link-button" onClick={async () => { await deleteRedirect(r.from_slug); onChange(); }}>Remove</button>
          </li>
        ))}
      </ul>
      <div className="row-wrap">
        <input aria-label="Old address" placeholder="old-name" value={from} onChange={(e) => setFrom(slugify(e.target.value))} />
        <VisibilitySelect label="Redirect visibility" value={visibility} onChange={setVisibility} />
        <button
          type="button"
          className="button secondary small"
          disabled={!from}
          onClick={async () => {
            setError(null);
            try {
              await addRedirect(from, articleId, visibility);
              setFrom('');
              onChange();
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Could not add it.');
            }
          }}
        >
          Add redirect
        </button>
      </div>
      {error && <p className="form-error">{error}</p>}
    </section>
  );
}
