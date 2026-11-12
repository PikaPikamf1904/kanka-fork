// The Goblin Gazette: an in-world newspaper built on Chronicle pages of type 'news'.
// Readers only ever receive published stories (Row Level Security); the DM also sees the desk.
import '@fontsource/unifrakturmaguntia/400.css';
import '@fontsource/im-fell-english/400.css';
import '@fontsource/im-fell-english/400-italic.css';
import '@fontsource/old-standard-tt/400.css';
import '@fontsource/old-standard-tt/400-italic.css';
import '@fontsource/old-standard-tt/700.css';
import '../styles/gazette.css';
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { ImageField } from '../components/images/ImageField.tsx';
import { MarkdownField } from '../components/images/MarkdownField.tsx';
import { Markdown } from '../components/Markdown.tsx';
import { useMediaUrl } from '../components/MediaImage.tsx';
import {
  articlesBySlugs, getNewsStory, listNews, listNewsPending, newsTransition, saveNewsStory,
  type NewsAction, type NewsDetails, type NewsDraft, type NewsStory,
} from '../lib/api.ts';
import { ChronicleError } from '../lib/changeSetTypes.ts';
import { longDate } from '../lib/dates.ts';
import { GAZETTE, RELIABILITY, REVIEW_LABEL, reporter, SECTIONS, sectionLabel, STAFF, type NewsReliability, type NewsReviewState, type NewsSection } from '../lib/gazette.ts';
import { useIsDm } from '../lib/session.tsx';
import { slugify, wikiLinkTargets } from '../lib/slug.ts';
import { TEMPLATES } from '../lib/templates.ts';
import type { ArticleRef } from '../lib/types.ts';
import { useLoad } from '../lib/useLoad.ts';
import { NotFound } from './NotFound.tsx';

/** Plain text from Markdown, for standfirsts and excerpts. */
function plain(md: string): string {
  return md
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`>#]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
const excerpt = (md: string, words = 48) => {
  const w = plain(md).split(' ');
  return w.length <= words ? w.join(' ') : `${w.slice(0, words).join(' ')}…`;
};
const isPublished = (s: Pick<NewsStory, 'status' | 'visibility'>) => s.status === 'published' && s.visibility === 'players';

function Stamp({ reliability }: { reliability: NewsReliability | undefined }) {
  const r = RELIABILITY[reliability ?? 'confirmed'];
  if (!r.stamp) return null;
  return <span className={`gz-stamp gz-stamp-${reliability}`} title={r.note}>{r.stamp}</span>;
}

function Byline({ details, date }: { details: NewsDetails | null; date?: string | null }) {
  const who = reporter(details?.reporter);
  return (
    <p className="gz-byline">
      <span className="gz-by">By <strong>{who.name}</strong>, {who.title}</span>
      {(details?.dateline || details?.in_world_date) && (
        <span className="gz-dateline">
          {details?.dateline && <span className="gz-place">{details.dateline}</span>}
          {details?.dateline && details?.in_world_date && ' — '}
          {details?.in_world_date}
        </span>
      )}
      {date && <span className="gz-printed">Printed {longDate(date)}</span>}
    </p>
  );
}

export function Masthead({ issue, compact = false }: { issue?: number | null; compact?: boolean }) {
  return (
    <header className={compact ? 'gz-masthead gz-masthead-compact' : 'gz-masthead'}>
      <div className="gz-ears">
        <span>{issue ? `Vol. I · No. ${issue}` : 'Vol. I'}</span>
        <span className="gz-ear-mid">{GAZETTE.description}</span>
        <span>{GAZETTE.price}</span>
      </div>
      <Link to="/news" className="gz-title">{GAZETTE.name}</Link>
      <p className="gz-tagline">“{GAZETTE.tagline}”</p>
      <nav className="gz-sections" aria-label="Gazette sections">
        <Link to="/news">Front page</Link>
        {SECTIONS.map((s) => <Link key={s.key} to={`/news?section=${s.key}`}>{s.short}</Link>)}
        <Link to="/news/archive">Archive</Link>
      </nav>
    </header>
  );
}

/** A story's picture, engraved-plate style. Nothing at all when there is none or it may not be shown. */
function LeadArt({ id, alt, caption }: { id: string | null | undefined; alt: string; caption?: string }) {
  const url = useMediaUrl(id);
  if (!id || !url) return null;
  return (
    <figure className="gz-art">
      <img src={url} alt={alt} loading="lazy" decoding="async" referrerPolicy="no-referrer" />
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  );
}

function StoryTeaser({ s, size = 'normal' }: { s: NewsStory; size?: 'lead' | 'normal' | 'brief' }) {
  const first = plain(s.summary || '');
  return (
    <article className={`gz-teaser gz-teaser-${size}`}>
      {size === 'lead' && <LeadArt id={s.hero_media_id} alt="" />}
      <p className="gz-kicker">{sectionLabel(s.news?.section)} <Stamp reliability={s.news?.reliability} /></p>
      <h2 className="gz-headline"><Link to={`/news/${s.slug}`}>{s.title}</Link></h2>
      {s.subtitle && size !== 'brief' && <p className="gz-deck">{s.subtitle}</p>}
      {size !== 'brief' && <p className="gz-teaser-by">By {reporter(s.news?.reporter).name}{s.news?.dateline ? ` · ${s.news.dateline}` : ''}</p>}
      {first && <p className={size === 'lead' && first.length > 320 ? 'gz-excerpt gz-excerpt-cols' : 'gz-excerpt'}>{size === 'lead' ? first : excerpt(first, size === 'brief' ? 22 : 40)}</p>}
      {size !== 'brief' && <Link to={`/news/${s.slug}`} className="gz-more">Read the whole story</Link>}
    </article>
  );
}

function NewsroomStrip({ stories }: { stories: NewsStory[] }) {
  const pending = stories.filter((s) => !isPublished(s));
  if (pending.length === 0) return <p className="gz-newsroom">DM: nothing waiting on the desk. <Link to="/dm/news/new">Write a story</Link></p>;
  const n = (k: string) => pending.filter((s) => (s.news?.review_state ?? 'draft') === k).length;
  return (
    <p className="gz-newsroom" role="status">
      DM: on the desk, unseen by players: {n('draft')} draft, {n('in_review')} in review, {n('approved')} approved but not printed. <Link to="/dm/news">Open the news desk</Link>
    </p>
  );
}

export function GazetteFront() {
  const isDm = useIsDm();
  const [params] = useSearchParams();
  const section = params.get('section') as NewsSection | null;
  const news = useLoad(listNews, [isDm]);
  useEffect(() => { document.title = `${GAZETTE.name} · Chronicle`; }, []);

  // The front page is what players see: published stories only, even for the DM.
  const printed = (news.data ?? []).filter(isPublished);
  const issue = printed.reduce((m, s) => Math.max(m, s.news?.issue_number ?? 0), 0) || null;
  const shown = section ? printed.filter((s) => s.news?.section === section) : printed;
  const lead = section ? shown[0] : shown.find((s) => s.news?.is_lead) ?? shown.find((s) => s.news?.reliability === 'confirmed') ?? shown[0];
  const rest = shown.filter((s) => s !== lead);
  const rumorMill = section ? [] : rest.filter((s) => s.news?.section === 'rumors' || s.news?.reliability === 'rumor').slice(0, 4);
  const corrections = section ? [] : rest.filter((s) => s.news?.section === 'corrections' || s.news?.reliability === 'correction').slice(0, 3);
  const columns = rest.filter((s) => !rumorMill.includes(s) && !corrections.includes(s));

  return (
    <div className="gazette">
      <Masthead issue={issue} />
      {isDm && news.data && <NewsroomStrip stories={news.data} />}
      {news.error && <p className="form-error">{news.error}</p>}
      {news.loading && !news.data && <p className="muted">The presses are warming up…</p>}
      {news.data && shown.length === 0 && (
        <section className="gz-empty">
          <h2 className="gz-headline">{section ? `No ${sectionLabel(section).toLowerCase()} yet` : 'The presses are quiet'}</h2>
          <p>The goblins are out looking for news. Several of them are looking in the wrong places.</p>
          {isDm && <p><Link className="button" to="/dm/news/new">Write the first story</Link></p>}
        </section>
      )}
      {lead && (
        <div className="gz-front">
          <div className="gz-main">
            {section && <h2 className="gz-section-title">{sectionLabel(section)}</h2>}
            <StoryTeaser s={lead} size="lead" />
            {columns.length > 0 && (
              <div className="gz-columns">
                {columns.map((s) => <StoryTeaser key={s.id} s={s} />)}
              </div>
            )}
          </div>
          {!section && (
            <aside className="gz-side" aria-label="Rumors, corrections and staff">
              {rumorMill.length > 0 && (
                <section className="gz-box">
                  <h2 className="gz-box-title">The Rumor Mill</h2>
                  <p className="gz-box-note">Unconfirmed. Possibly invented. Definitely printed.</p>
                  {rumorMill.map((s) => <StoryTeaser key={s.id} s={s} size="brief" />)}
                </section>
              )}
              {corrections.length > 0 && (
                <section className="gz-box">
                  <h2 className="gz-box-title">Corrections</h2>
                  {corrections.map((s) => <StoryTeaser key={s.id} s={s} size="brief" />)}
                </section>
              )}
              <StaffBox />
            </aside>
          )}
        </div>
      )}
    </div>
  );
}

function StaffBox() {
  return (
    <section className="gz-box gz-staff">
      <h2 className="gz-box-title">The Masthead</h2>
      <ul>
        {STAFF.map((r) => (
          <li key={r.key}><strong>{r.name}</strong>, {r.title}. <em>{r.sign}</em></li>
        ))}
      </ul>
    </section>
  );
}

export function GazetteArchive() {
  const isDm = useIsDm();
  const news = useLoad(listNews, [isDm]);
  const printed = (news.data ?? []).filter(isPublished);
  const issues = new Map<string, NewsStory[]>();
  for (const s of printed) {
    const k = s.news?.issue_number ? `No. ${s.news.issue_number}` : 'Special editions';
    issues.set(k, [...(issues.get(k) ?? []), s]);
  }
  return (
    <div className="gazette">
      <Masthead compact />
      <h1 className="gz-section-title">The Archive</h1>
      {news.data && printed.length === 0 && <p className="muted">No issues printed yet.</p>}
      {[...issues.entries()].map(([label, stories]) => (
        <section key={label} className="gz-issue">
          <h2>Issue {label}{stories[0]?.news?.in_world_date ? <span className="muted"> · {stories[0].news.in_world_date}</span> : null}</h2>
          <ul>
            {stories.map((s) => (
              <li key={s.id}>
                <span className="gz-kicker">{sectionLabel(s.news?.section)}</span>{' '}
                <Link to={`/news/${s.slug}`}>{s.title}</Link> <Stamp reliability={s.news?.reliability} />
                <span className="muted"> · {reporter(s.news?.reporter).name}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** The printed story. Used by the story page and by the editor's preview. */
function StoryView({ title, deck, summary, body, details, date, related, corrects, toolbar, heroMediaId }: {
  title: string; deck: string; summary: string; body: string; details: NewsDetails | null; heroMediaId?: string | null;
  date?: string | null; related: ArticleRef[]; corrects?: { slug: string; title: string } | null; toolbar?: ReactNode;
}) {
  const rel = RELIABILITY[details?.reliability ?? 'confirmed'];
  return (
    <article className={`gz-story gz-story-${details?.reliability ?? 'confirmed'}`}>
      {toolbar}
      <p className="gz-kicker">{sectionLabel(details?.section)} <Stamp reliability={details?.reliability} /></p>
      <h1 className="gz-headline gz-story-headline">{title || 'Untitled story'}</h1>
      {deck && <p className="gz-deck">{deck}</p>}
      <Byline details={details} date={date} />
      <LeadArt id={heroMediaId} alt={title} />
      {details?.reliability && details.reliability !== 'confirmed' && (
        <p className="gz-reliability-note"><strong>{rel.label}.</strong> {rel.note}</p>
      )}
      {corrects && <p className="gz-reliability-note">This corrects: <Link to={`/news/${corrects.slug}`}>{corrects.title}</Link></p>}
      <div className="gz-body">
        {summary && <div className="gz-standfirst"><Markdown text={summary} /></div>}
        <div className={summary ? 'gz-text' : 'gz-text gz-text-first'}><Markdown text={body} /></div>
      </div>
      <p className="gz-sign">{reporter(details?.reporter).sign}</p>
      {related.length > 0 && (
        <aside className="gz-related" aria-label="In the Chronicle">
          <h2>In the Chronicle</h2>
          <ul>
            {related.map((r) => (
              <li key={r.slug}><Link to={`/wiki/${r.slug}`}>{r.title}</Link> <span className="muted">· {TEMPLATES[r.type]?.label ?? r.type}</span></li>
            ))}
          </ul>
        </aside>
      )}
    </article>
  );
}

export function GazetteArticle() {
  const { slug = '' } = useParams();
  const isDm = useIsDm();
  const story = useLoad(async () => {
    const s = await getNewsStory(slug);
    if (!s) return null;
    const body = s.bundle.sections.map((x) => x.body).join('\n\n');
    const linked = await articlesBySlugs(wikiLinkTargets(`${s.bundle.article.summary}\n${body}`));
    const related = [...new Map([...linked.map((a) => ({ slug: a.slug, title: a.title, type: a.type })), ...s.bundle.relations.map((r) => r.other)]
      .filter((a) => a.type !== 'news').map((a) => [a.slug, a])).values()];
    let corrects: { slug: string; title: string } | null = null;
    if (s.news?.corrects_article_id) {
      const all = await listNews();
      const c = all.find((x) => x.id === s.news?.corrects_article_id);
      corrects = c ? { slug: c.slug, title: c.title } : null;
    }
    return { ...s, body, related, corrects };
  }, [slug, isDm]);
  useEffect(() => { if (story.data) document.title = `${story.data.bundle.article.title} · ${GAZETTE.name}`; }, [story.data]);

  if (story.error) return <p className="form-error">{story.error}</p>;
  if (story.loading && !story.data) return <div className="gazette"><Masthead compact /><p className="muted">Fetching the paper…</p></div>;
  if (!story.data) return <NotFound what="story" />;
  const { bundle, news, body, related, corrects } = story.data;
  const a = bundle.article;
  return (
    <div className="gazette">
      <Masthead compact issue={news?.issue_number} />
      <StoryView
        title={a.title} deck={a.subtitle} summary={a.summary} body={body} details={news} heroMediaId={a.hero_media_id}
        date={a.published_at} related={related} corrects={corrects}
        toolbar={isDm ? (
          <div className="gz-dm-bar">
            <span className={`badge ${isPublished(a) ? 'badge-ok' : 'badge-dm'}`}>{isPublished(a) ? 'Printed: players can read this' : 'Not printed: players cannot see this'}</span>
            <span className="badge">{REVIEW_LABEL[news?.review_state ?? 'draft']}</span>
            {story.data.pending && <span className="badge badge-dm">Revision waiting: {REVIEW_LABEL[story.data.pending.review_state]}</span>}
            <Link className="button small" to={`/dm/news/edit/${a.slug}`}>Edit</Link>
          </div>
        ) : undefined}
      />
      <p className="gz-back"><Link to="/news">← Back to the front page</Link></p>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// DM: the news desk and the story editor
// ---------------------------------------------------------------------------------------------
const STATE_ORDER = ['in_review', 'draft', 'approved'] as const;

export function GazetteDesk() {
  const news = useLoad(async () => {
    const [stories, pending] = await Promise.all([listNews(), listNewsPending()]);
    return stories.map((s) => ({ ...s, pendingState: pending.get(s.id) ?? null }));
  }, []);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  async function act(id: string, action: NewsAction) {
    setBusy(id); setError('');
    try {
      await newsTransition(id, action);
      news.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change the story.');
    } finally {
      setBusy('');
    }
  }
  const all = news.data ?? [];
  const printed = all.filter(isPublished);
  const desk = all.filter((s) => !isPublished(s)).sort((a, b) => STATE_ORDER.indexOf((a.news?.review_state ?? 'draft') as never) - STATE_ORDER.indexOf((b.news?.review_state ?? 'draft') as never));
  return (
    <div className="gazette gz-desk">
      <Masthead compact />
      <div className="toolbar">
        <h1 className="page-title">The news desk</h1>
        <div className="toolbar-actions"><Link className="button" to="/dm/news/new">Write a story</Link></div>
      </div>
      <p className="muted">Every story goes Draft → In review → Approved → Printed. Players see nothing until you print it, and taking a story back to draft un-prints it at once. Editing a printed story makes a revision: players keep the printed version until you approve the revision. Assistants can draft stories; only you, here, can approve and print them. See <code>docs/chronicle/GOBLIN-GAZETTE.md</code>.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <h2>On the desk</h2>
      {desk.length === 0 ? <p className="muted">Nothing waiting.</p> : <DeskTable stories={desk} busy={busy} act={act} />}
      <h2>Printed</h2>
      {printed.length === 0 ? <p className="muted">Nothing printed yet.</p> : <DeskTable stories={printed} busy={busy} act={act} />}
    </div>
  );
}

type DeskStory = NewsStory & { pendingState: NewsReviewState | null };
function DeskTable({ stories, busy, act }: { stories: DeskStory[]; busy: string; act: (id: string, a: NewsAction) => void }) {
  return (
    <div className="table-scroll">
      <table className="table gz-desk-table">
        <thead><tr><th scope="col">Headline</th><th scope="col">Section</th><th scope="col">Reporter</th><th scope="col">State</th><th scope="col">Next step</th></tr></thead>
        <tbody>
          {stories.map((s) => {
            const state = s.news?.review_state ?? 'draft';
            const printed = isPublished(s);
            return (
              <tr key={s.id}>
                <td><Link to={`/dm/news/edit/${s.slug}`}>{s.title}</Link> <Stamp reliability={s.news?.reliability} /></td>
                <td>{sectionLabel(s.news?.section)}</td>
                <td>{reporter(s.news?.reporter).name}</td>
                <td>{printed ? 'Printed' : REVIEW_LABEL[state]}{printed && s.pendingState && <><br /><span className="badge badge-dm">Revision: {REVIEW_LABEL[s.pendingState]}</span></>}</td>
                <td><StoryActions id={s.id} state={state} printed={printed} pending={s.pendingState} busy={busy === s.id} act={act} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function StoryActions({ id, state, printed, pending = null, busy, act }: { id: string; state: string; printed: boolean; pending?: NewsReviewState | null; busy: boolean; act: (id: string, a: NewsAction) => void }) {
  const b = (label: string, a: NewsAction, cls = 'button small secondary') => (
    <button key={a} type="button" className={cls} disabled={busy} onClick={() => act(id, a)}>{label}</button>
  );
  if (printed && pending === 'draft') return <span className="gz-actions">{b('Send revision for review', 'submit', 'button small')}{b('Discard revision', 'discard')}</span>;
  if (printed && pending === 'in_review') return <span className="gz-actions">{b('Approve revision', 'approve', 'button small')}{b('Discard revision', 'discard')}</span>;
  if (printed) return <span className="gz-actions">{b('Unprint', 'unpublish')}{b('Back to draft', 'return')}</span>;
  if (state === 'draft') return <span className="gz-actions">{b('Send for review', 'submit', 'button small')}</span>;
  if (state === 'in_review') return <span className="gz-actions">{b('Approve', 'approve', 'button small')}{b('Back to draft', 'return')}</span>;
  return <span className="gz-actions">{b('Print for players', 'publish', 'button small')}{b('Back to draft', 'return')}</span>;
}

const EMPTY_DETAILS: NewsDraft['details'] = {
  section: 'local', reliability: 'confirmed', reporter: 'mossbottom', dateline: '', in_world_date: '', issue_number: null, is_lead: false, corrects_article_id: null,
};

export function GazetteEditor() {
  const { slug } = useParams();
  const existing = useLoad(async () => (slug ? getNewsStory(slug) : null), [slug]);
  const [flash, setFlash] = useState<string | null>(null);
  if (slug && existing.loading && !existing.data) return <p className="muted">Loading…</p>;
  if (slug && !existing.loading && !existing.data) return <NotFound what="story" />;
  const e = existing.data ?? null;
  // A fresh form after every save or state change (the key changes with the version and state).
  const key = e ? `${e.bundle.article.id}:${e.bundle.article.version}:${e.news?.review_state}:${e.bundle.article.status}:${e.pending?.review_state ?? ''}:${e.pending?.updated_at ?? ''}` : 'new';
  return <StoryEditor key={key} e={e} reload={existing.reload} flash={flash} setFlash={setFlash} />;
}

type Loaded = NonNullable<Awaited<ReturnType<typeof getNewsStory>>>;

function StoryEditor({ e, reload, flash, setFlash }: { e: Loaded | null; reload: () => void; flash: string | null; setFlash: (m: string | null) => void }) {
  const navigate = useNavigate();
  const others = useLoad(listNews, []);
  // A printed story with a waiting revision opens the revision; the printed version stays as it is.
  const rev = e?.pending?.story ?? null;
  const [form, setForm] = useState(() => (rev ? {
    title: rev.article.title, slug: rev.article.slug, subtitle: rev.article.subtitle ?? '', summary: rev.article.summary ?? '',
    heroMediaId: rev.article.hero_media_id ?? null,
    body: (rev.sections ?? []).map((x) => x.body).join('\n\n'), sectionId: e?.bundle.sections[0]?.id as string | undefined,
    details: { ...EMPTY_DETAILS, ...(rev.details ?? {}) } as NewsDraft['details'],
  } : e ? {
    title: e.bundle.article.title, slug: e.bundle.article.slug, subtitle: e.bundle.article.subtitle, summary: e.bundle.article.summary,
    heroMediaId: e.bundle.article.hero_media_id,
    body: e.bundle.sections.map((x) => x.body).join('\n\n'), sectionId: e.bundle.sections[0]?.id as string | undefined,
    details: { ...EMPTY_DETAILS, ...(e.news ?? {}) } as NewsDraft['details'],
  } : { heroMediaId: null as string | null, title: '', slug: '', subtitle: '', summary: '', body: '', sectionId: undefined as string | undefined, details: EMPTY_DETAILS }));
  const [touchedSlug, setTouchedSlug] = useState(false);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(flash ? { ok: true, text: flash } : null);

  const voice = useMemo(() => reporter(form?.details.reporter).voice, [form?.details.reporter]);
  const state = e?.news?.review_state ?? 'draft';
  const printed = e ? isPublished(e.bundle.article) : false;
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const setD = (patch: Partial<NewsDraft['details']>) => setForm((f) => ({ ...f, details: { ...f.details, ...patch } }));

  async function save(ev: FormEvent) {
    ev.preventDefault();
    setBusy(true); setMessage(null);
    try {
      const saved = await saveNewsStory({
        article: { id: e?.bundle.article.id, slug: form.slug || slugify(form.title), title: form.title, subtitle: form.subtitle, summary: form.summary, hero_media_id: form.heroMediaId },
        sections: [{ id: form.sectionId, heading: '', body: form.body, visibility: 'players', status: 'published' }],
        details: form.details,
      }, e ? `v${e.bundle.article.version}` : undefined);
      const done = saved.pending
        ? 'Saved as a revision. Players still see the printed version until you send this for review and approve it.'
        : state === 'approved' && !printed ? 'Saved. Because the story changed after approval, it is back in review.' : 'Saved. Players cannot see it until you print it.';
      setMessage({ ok: true, text: done });
      setFlash(done);
      if (!e || saved.slug !== e.bundle.article.slug) navigate(`/dm/news/edit/${saved.slug}`, { replace: true });
      else reload();
    } catch (err) {
      const text = err instanceof ChronicleError && err.code === 'CONFLICT'
        ? 'This story was changed somewhere else since you opened it. Copy your text, reload, and try again.'
        : err instanceof Error ? err.message : 'Could not save.';
      setMessage({ ok: false, text });
    } finally {
      setBusy(false);
    }
  }
  async function act(action: NewsAction) {
    if (!e) return;
    setBusy(true); setMessage(null);
    try {
      const r = await newsTransition(e.bundle.article.id, action);
      setFlash(action === 'approve' && printed ? 'Revision approved: players now read the new version.'
        : action === 'discard' ? 'Revision discarded: the printed version is unchanged.'
        : action === 'submit' && printed ? 'Revision sent for review. Players still see the printed version.'
        : r.status === 'published' ? 'Printed: players can now read this story.'
        : action === 'unpublish' || action === 'return' ? 'Taken out of the paper: players can no longer see it.'
        : `Now: ${REVIEW_LABEL[r.review_state]}.`);
      reload();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : 'Could not change the story.' });
    } finally {
      setBusy(false);
    }
  }

  const details: NewsDetails = { ...form.details, review_state: state, reviewed_at: null };
  return (
    <div className="gazette gz-editor">
      <p className="muted"><Link to="/dm/news">News desk</Link> › {e ? 'Edit story' : 'New story'}</p>
      <div className="toolbar">
        <h1 className="page-title">{e ? 'Edit story' : 'Write a story'}</h1>
        <div className="toolbar-actions">
          <button type="button" className="button secondary" aria-pressed={preview} onClick={() => setPreview((p) => !p)}>{preview ? 'Back to editing' : 'Preview as printed'}</button>
        </div>
      </div>
      {e && (
        <section className="panel gz-workflow" aria-label="Review and printing">
          <div>
            <p><strong>{printed ? 'Printed: players can read this story.' : `${REVIEW_LABEL[state]}: players cannot see this story.`}</strong></p>
            {printed && !e.pending && <p className="fine-print">Saving changes makes a revision. Players keep reading the printed version until you approve it.</p>}
            {printed && e.pending && <p className="fine-print gz-revision-note">You are editing a revision ({REVIEW_LABEL[e.pending.review_state].toLowerCase()}). Players still see the printed version.</p>}
          </div>
          <StoryActions id={e.bundle.article.id} state={state} printed={printed} pending={e.pending?.review_state ?? null} busy={busy} act={(_id, a) => void act(a)} />
        </section>
      )}
      {message && <p className={message.ok ? 'form-ok' : 'form-error'} role={message.ok ? 'status' : 'alert'}>{message.text}</p>}

      {preview ? (
        <StoryView title={form.title} deck={form.subtitle} summary={form.summary} body={form.body} details={details} related={[]} heroMediaId={form.heroMediaId} />
      ) : (
        <form className="form-grid gz-form" onSubmit={save}>
          <label className="span-2">Headline
            <input value={form.title} required maxLength={200} onChange={(ev) => set({ title: ev.target.value, slug: touchedSlug || e ? form.slug : slugify(ev.target.value) })} />
          </label>
          <label>Address
            <input value={form.slug} pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={160} onChange={(ev) => { setTouchedSlug(true); set({ slug: ev.target.value }); }} />
          </label>
          <label>Section
            <select value={form.details.section} onChange={(ev) => setD({ section: ev.target.value as NewsSection })}>
              {SECTIONS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </label>
          <label className="span-2">Deck (the line under the headline)
            <input value={form.subtitle} maxLength={200} onChange={(ev) => set({ subtitle: ev.target.value })} />
          </label>
          <label className="span-2">Opening paragraph
            <textarea rows={3} value={form.summary} maxLength={2000} onChange={(ev) => set({ summary: ev.target.value })} />
          </label>
          <label>Kind of reporting
            <select value={form.details.reliability} onChange={(ev) => setD({ reliability: ev.target.value as NewsReliability })}>
              {(Object.keys(RELIABILITY) as NewsReliability[]).map((k) => <option key={k} value={k}>{RELIABILITY[k].label}</option>)}
            </select>
            <span className="fine-print">{RELIABILITY[form.details.reliability].note}</span>
          </label>
          <label>Reporter
            <select value={form.details.reporter} onChange={(ev) => setD({ reporter: ev.target.value })}>
              {STAFF.map((r) => <option key={r.key} value={r.key}>{r.name}, {r.title}</option>)}
            </select>
            <span className="fine-print">Voice: {voice}</span>
          </label>
          <label>Dateline (place)
            <input value={form.details.dateline} maxLength={120} placeholder="e.g. a town the party visited" onChange={(ev) => setD({ dateline: ev.target.value })} />
          </label>
          <label>In-world date
            <input value={form.details.in_world_date} maxLength={120} onChange={(ev) => setD({ in_world_date: ev.target.value })} />
          </label>
          <label>Issue number
            <input type="number" min={1} value={form.details.issue_number ?? ''} onChange={(ev) => setD({ issue_number: ev.target.value ? Number(ev.target.value) : null })} />
          </label>
          <label>Corrects an earlier story
            <select value={form.details.corrects_article_id ?? ''} onChange={(ev) => setD({ corrects_article_id: ev.target.value || null })}>
              <option value="">None</option>
              {(others.data ?? []).filter((s) => s.id !== e?.bundle.article.id).map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
            </select>
          </label>
          <label className="checkbox span-2">
            <input type="checkbox" checked={form.details.is_lead} onChange={(ev) => setD({ is_lead: ev.target.checked })} /> Lead story on the front page
          </label>
          <div className="span-2">
            <ImageField
              label="Story picture"
              purpose="landscape"
              mediaId={form.heroMediaId}
              onChange={(id) => set({ heroMediaId: id })}
              hint="Shown under the headline and on the front page if it is the lead story. Players see it only once the story is printed."
              testId="story-picture"
            />
          </div>
          <div className="span-2 gz-story-field">
            <span className="field-label">Story</span>
            <MarkdownField label="Story" rows={16} value={form.body} onChange={(body) => set({ body })} />
            <span className="fine-print">Markdown. Link Chronicle pages with [[page-address]] or [[page-address|shown text]]; they appear under “In the Chronicle”. Use <strong>Add image</strong> for pictures. Only write what players may know: printing makes the whole story public to them.</span>
          </div>
          <div className="form-actions">
            <button type="submit" className="button" disabled={busy || !form.title.trim()}>{busy ? 'Saving…' : 'Save story'}</button>
            <Link className="button secondary" to="/dm/news">Back to the desk</Link>
          </div>
        </form>
      )}
    </div>
  );
}
