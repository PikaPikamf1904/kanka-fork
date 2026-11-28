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
  acceptNewsProposal, articlesBySlugs, dismissNewsProposal, getCampaignZone, getNewsStory, listLetters, listNews, listNewsIndex, importGazetteStories, listGazetteHeadlines, listNewsPending, listNewsProposals, listPrintedNews, listScheduled, listUnprintedNews, newsTransition, releaseDueStories, saveNewsStory, scheduleNewsProposals,
  type NewsAction, type NewsDetails, type NewsDraft, type NewsProposal, type NewsStory,
} from '../lib/api.ts';
import { ChronicleError } from '../lib/changeSetTypes.ts';
import { longDate } from '../lib/dates.ts';
import { GAZETTE, isLetter, RELIABILITY, REVIEW_LABEL, reporter, SECTIONS, sectionLabel, STAFF, type NewsReliability, type NewsReviewState, type NewsSection } from '../lib/gazette.ts';
import { useIsDm } from '../lib/session.tsx';
import { slugify, wikiLinkTargets } from '../lib/slug.ts';
import { loadNamedIn } from '../lib/mentions.ts';
import { TEMPLATES } from '../lib/templates.ts';
import type { ArticleRef } from '../lib/types.ts';
import { useLoad } from '../lib/useLoad.ts';
import { useUnsavedGuard } from '../lib/useUnsavedGuard.ts';
import { NotFound } from './NotFound.tsx';
import { ScheduleControl } from './dm/ScheduleControls.tsx';
import { formatInZone, utcToZoned, zonedToUtc } from '../lib/schedule.ts';
import { duplicateHeadlines, parseGazettePackage, type PackageStory } from '../lib/gazettePackage.ts';

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
        <Link to="/letters">Letters</Link>
        <Link to="/news/archive">Archive</Link>
      </nav>
    </header>
  );
}

/** A story's picture, engraved-plate style. Nothing at all when there is none or it may not be shown. */
function LeadArt({ id, alt, caption }: { id: string | null | undefined; alt: string; caption?: string }) {
  const { url, onError } = useMediaUrl(id);
  if (!id || !url) return null;
  return (
    <figure className="gz-art">
      <img src={url} alt={alt} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => onError()} />
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

/** How many of the newest printed stories the front page lays out. */
const FRONT_PAGE_STORIES = 40;

export function GazetteFront() {
  const isDm = useIsDm();
  const [params] = useSearchParams();
  const section = params.get('section') as NewsSection | null;
  // The front page is what players see: the newest printed stories only, even for the DM. Older
  // stories stay in the archive and in search.
  const news = useLoad(async () => { await releaseDueStories(); return listPrintedNews({ section, limit: FRONT_PAGE_STORIES }); }, [isDm, section]);
  const letters = useLoad(async () => (section ? [] : (await listLetters(3))), [isDm, section]);
  const desk = useLoad(() => (isDm ? listUnprintedNews() : Promise.resolve([])), [isDm]);
  useEffect(() => { document.title = `${GAZETTE.name} · Chronicle`; }, []);

  const printed = news.data ?? [];
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
      {isDm && desk.data && <NewsroomStrip stories={desk.data} />}
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
            {printed.length === FRONT_PAGE_STORIES && (
              <p className="gz-more"><Link to="/news/archive">Older stories are in the Archive</Link></p>
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
              {(letters.data?.length ?? 0) > 0 && (
                <section className="gz-box">
                  <h2 className="gz-box-title">Letters from Krynn</h2>
                  <p className="gz-box-note">Correspondence that found its way to the party.</p>
                  <ul className="gz-letter-list">
                    {letters.data!.map((l) => (
                      <li key={l.id}><Link to={`/news/${l.slug}`}>{l.title}</Link><span className="muted"> · from {l.news?.letter_from || 'someone'}</span></li>
                    ))}
                  </ul>
                  <p className="gz-more"><Link to="/letters">All letters</Link></p>
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
        {STAFF.filter((r) => !r.variantOf).map((r) => (
          <li key={r.key}><strong>{r.name}</strong>, {r.title}. <em>{r.sign}</em></li>
        ))}
      </ul>
    </section>
  );
}

export function GazetteArchive() {
  const isDm = useIsDm();
  const news = useLoad(async () => { await releaseDueStories(); return listNewsIndex(); }, [isDm]);
  const printed = news.data ?? [];
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

/** Letters from Krynn: every printed letter, newest first. */
export function GazetteLetters() {
  const isDm = useIsDm();
  const letters = useLoad(async () => { await releaseDueStories(); return listLetters(200); }, [isDm]);
  useEffect(() => { document.title = `Letters from Krynn · ${GAZETTE.name}`; }, []);
  return (
    <div className="gazette">
      <Masthead compact />
      <h1 className="gz-section-title">Letters from Krynn</h1>
      {letters.error && <p className="form-error">{letters.error}</p>}
      {letters.loading && !letters.data && <p className="muted">Looking through the post…</p>}
      {letters.data && letters.data.length === 0 && <p className="muted">No letters have arrived yet.</p>}
      <ul className="lt-index">
        {(letters.data ?? []).map((l) => (
          <li key={l.id}>
            <Link to={`/news/${l.slug}`} className="lt-index-title">{l.title}</Link>
            <span className="lt-index-meta">From {l.news?.letter_from || 'an unknown hand'}{l.news?.letter_to ? ` to ${l.news.letter_to}` : ''}{l.news?.in_world_date ? ` · ${l.news.in_world_date}` : ''}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One letter, set as correspondence rather than as a newspaper story. */
function LetterView({ title, body, details, heroMediaId, date, toolbar }: {
  title: string; body: string; details: NewsDetails | null; heroMediaId?: string | null; date?: string | null; toolbar?: ReactNode;
}) {
  const rel = RELIABILITY[details?.reliability ?? 'confirmed'];
  return (
    <article className="lt-letter">
      {toolbar}
      <header className="lt-head">
        <p className="lt-place-date">
          {details?.dateline && <span>{details.dateline}</span>}
          {(details?.in_world_date || date) && <span>{details?.in_world_date || longDate(date)}</span>}
        </p>
        <h1 className="lt-subject">{title || 'Untitled letter'}</h1>
        <p className="lt-route">
          {details?.letter_from && <span>From <strong>{details.letter_from}</strong></span>}
          {details?.letter_to && <span>To <strong>{details.letter_to}</strong></span>}
        </p>
      </header>
      {details?.reliability && details.reliability !== 'confirmed' && <p className="lt-note"><strong>{rel.label}.</strong> {rel.note}</p>}
      <LeadArt id={heroMediaId} alt="" />
      <div className="lt-body"><Markdown text={body} /></div>
      {details?.letter_signature && <p className="lt-signature">{details.letter_signature}</p>}
    </article>
  );
}

/** The printed story. Used by the story page and by the editor's preview. */
function StoryView({ title, kicker, deck, summary, body, details, date, related, corrects, toolbar, heroMediaId }: {
  title: string; kicker: string; deck: string; summary: string; body: string; details: NewsDetails | null; heroMediaId?: string | null;
  date?: string | null; related: ArticleRef[]; corrects?: { slug: string; title: string } | null; toolbar?: ReactNode;
}) {
  const rel = RELIABILITY[details?.reliability ?? 'confirmed'];
  return (
    <article className={`gz-story gz-story-${details?.reliability ?? 'confirmed'}`}>
      {toolbar}
      <p className="gz-kicker">{sectionLabel(details?.section)}{kicker ? ` · ${kicker}` : ''} <Stamp reliability={details?.reliability} /></p>
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
    await releaseDueStories();
    const s = await getNewsStory(slug);
    if (!s) return null;
    const body = s.bundle.sections.map((x) => x.body).join('\n\n');
    const [linked, named] = await Promise.all([
      articlesBySlugs(wikiLinkTargets(`${s.bundle.article.summary}\n${body}`).map((t) => slugify(t))),
      // Pages the story names without a [[link]], from the reader's own access (see mentions.ts).
      loadNamedIn(s.bundle.article.id),
    ]);
    const related = [...new Map([...linked.map((a) => ({ slug: a.slug, title: a.title, type: a.type })), ...s.bundle.relations.map((r) => r.other), ...named]
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
  if (isLetter(news)) {
    return (
      <div className="gazette">
        <Masthead compact />
        <LetterView title={a.title} body={[a.summary, body].filter(Boolean).join('\n\n')} details={news} heroMediaId={a.hero_media_id} date={a.published_at}
          toolbar={isDm ? (
            <div className="gz-dm-bar">
              <span className={`badge ${isPublished(a) ? 'badge-ok' : 'badge-dm'}`}>{isPublished(a) ? 'Delivered: players can read this' : 'Not delivered: players cannot see this'}</span>
              <span className="badge">{REVIEW_LABEL[news?.review_state ?? 'draft']}</span>
              <Link className="button small" to={`/dm/news/edit/${a.slug}`}>Edit</Link>
            </div>
          ) : undefined} />
        <p className="gz-back"><Link to="/letters">← All letters</Link></p>
      </div>
    );
  }
  return (
    <div className="gazette">
      <Masthead compact issue={news?.issue_number} />
      <StoryView
        title={a.title} kicker="" deck={a.subtitle} summary={a.summary} body={body} details={news} heroMediaId={a.hero_media_id}
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
    await releaseDueStories(true);
    const [stories, pending, scheduled, zone] = await Promise.all([listNews(), listNewsPending(), listScheduled(), getCampaignZone()]);
    return {
      zone,
      stories: stories.map((s) => ({ ...s, pendingState: pending.get(s.id)?.review_state ?? null, pendingAt: pending.get(s.id)?.updated_at ?? null, scheduledAt: scheduled.get(s.id) ?? null })),
    };
  }, []);
  const [notice, setNotice] = useState('');
  const [proposalsKey, setProposalsKey] = useState(0);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  async function act(id: string, action: NewsAction) {
    const story = news.data?.stories.find((s) => s.id === id);
    if (!story) return;
    setBusy(id); setError('');
    try {
      await newsTransition(id, action, { version: story.version, revision: story.pendingAt });
    } catch (e) {
      setError(e instanceof ChronicleError && e.code === 'CONFLICT'
        ? `“${story.title}” was changed somewhere else since this list was loaded, so nothing was done. The list is now up to date: open the story to read the current text.`
        : e instanceof Error ? e.message : 'Could not change the story.');
    } finally {
      news.reload();
      setBusy('');
    }
  }
  const all = news.data?.stories ?? [];
  const zone = news.data?.zone ?? 'UTC';
  const printed = all.filter(isPublished);
  const scheduled = all.filter((s) => !isPublished(s) && s.scheduledAt).sort((a, b) => a.scheduledAt!.localeCompare(b.scheduledAt!));
  const desk = all.filter((s) => !isPublished(s) && !s.scheduledAt).sort((a, b) => STATE_ORDER.indexOf((a.news?.review_state ?? 'draft') as never) - STATE_ORDER.indexOf((b.news?.review_state ?? 'draft') as never));
  return (
    <div className="gazette gz-desk">
      <Masthead compact />
      <div className="toolbar">
        <h1 className="page-title">The news desk</h1>
        <div className="toolbar-actions"><Link className="button" to="/dm/news/new">Write a story</Link></div>
      </div>
      <p className="muted">Every story goes Draft → In review → Approved → Printed (now, or on a date you choose). Players see nothing until it is printed, and taking a story back to draft un-prints it at once. Editing a printed story makes a revision: players keep the printed version until you approve the revision. Assistants can draft stories; only you, here, can approve and print them. See <code>docs/chronicle/GOBLIN-GAZETTE.md</code>.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="form-ok" role="status">{notice}</p>}
      <GazetteImport onImported={(m) => { setNotice(m); setProposalsKey((k) => k + 1); }} />
      <NewsProposals key={proposalsKey} onDone={(m) => { setNotice(m); news.reload(); }} />
      <h2>On the desk</h2>
      {desk.length === 0 ? <p className="muted">Nothing waiting.</p> : <DeskTable stories={desk} busy={busy} act={act} zone={zone} onScheduled={(m) => { setNotice(m); news.reload(); }} />}
      <h2>Scheduled</h2>
      <p className="fine-print">Approved and waiting for their time, in the {zone} time zone. Players cannot see these. They print themselves when the time comes.</p>
      {scheduled.length === 0 ? <p className="muted">Nothing scheduled.</p> : <DeskTable stories={scheduled} busy={busy} act={act} zone={zone} onScheduled={(m) => { setNotice(m); news.reload(); }} />}
      <h2>Printed</h2>
      {printed.length === 0 ? <p className="muted">Nothing printed yet.</p> : <DeskTable stories={printed} busy={busy} act={act} zone={zone} onScheduled={() => undefined} />}
    </div>
  );
}

/**
 * Stories an assistant proposed. Accepting saves one as a private draft (it then follows the normal
 * review and printing); dismissing drops it. Assistants can do neither.
 */
/**
 * Import a Gazette package (one Markdown file, several complete stories). Stories are checked here, then
 * added to "Waiting for your approval" exactly as written; reading, approving and scheduling happen there.
 */
function GazetteImport({ onImported }: { onImported: (message: string) => void }) {
  const [file, setFile] = useState<{ name: string; stories: PackageStory[]; notes: string[]; zone: string; dup: Map<number, string> } | null>(null);
  const [include, setInclude] = useState<Set<number>>(new Set());
  const [section, setSection] = useState<Record<number, NewsSection | ''>>({});
  const [open, setOpen] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function read(f: File | undefined) {
    setError(''); setFile(null);
    if (!f) return;
    if (f.size > 1_000_000) { setError('That file is larger than 1 MB.'); return; }
    try {
      const [text, zone, existing] = await Promise.all([f.text(), getCampaignZone(), listGazetteHeadlines()]);
      const parsed = parseGazettePackage(text, zone);
      const dup = duplicateHeadlines(parsed.stories, existing);
      setFile({ name: f.name, ...parsed, zone, dup });
      setInclude(new Set(parsed.stories.filter((s) => s.problems.length === 0 && !dup.has(s.index)).map((s) => s.index)));
      setSection(Object.fromEntries(parsed.stories.map((s) => [s.index, s.section ?? ''])));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that file.');
    }
  }
  const chosen = (file?.stories ?? []).filter((s) => include.has(s.index));
  const missingSection = chosen.filter((s) => !section[s.index]);
  async function add() {
    if (!file || busy || chosen.length === 0 || missingSection.length > 0) return;
    setBusy(true); setError('');
    try {
      const n = await importGazetteStories(chosen.map((s) => ({
        title: s.headline, subtitle: s.subtitle, body: s.body, section: section[s.index] as NewsSection, reliability: s.reliability!, reporter: s.reporter!, suggested_publish_at: s.suggestedAt,
      })));
      setFile(null);
      onImported(`${n} ${n === 1 ? 'story' : 'stories'} added to “Waiting for your approval”. Read them there, then approve and schedule.`);
    } catch (e) {
      setError(e instanceof Error ? `Nothing was added. ${e.message}` : 'Nothing was added. Try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="panel gz-import">
      <summary><strong>Import Gazette package</strong> <span className="fine-print">— a Markdown file with several finished stories</span></summary>
      <p className="fine-print">Each story starts with <code>## 2026-11-26 05:45 MST — Headline</code>, then an italic subtitle, <code>**By Name, Title**</code> and <code>**Reliability: Rumor**</code> (optional <code>**Section: War**</code>). Stories are added exactly as written; nothing is published until you approve it below.</p>
      <label className="gz-import-file">Choose a file
        <input type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" onChange={(ev) => { const f = ev.target.files?.[0]; ev.target.value = ''; void read(f); }} />
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      {file && (
        <>
          {file.notes.map((n) => <p key={n} className="form-error">{n}</p>)}
          {file.stories.length > 0 && <p className="fine-print">{file.name}: {file.stories.length} {file.stories.length === 1 ? 'story' : 'stories'} found. Times read in {file.zone}.</p>}
          <ul className="gz-import-list">
            {file.stories.map((s) => {
              const blocked = s.problems.length > 0 || file.dup.has(s.index);
              return (
                <li key={s.index} className="gz-proposal" data-testid="package-story">
                  <label className="checkbox"><input type="checkbox" disabled={blocked} checked={include.has(s.index)} aria-label={`Import “${s.headline}”`}
                    onChange={() => setInclude((c) => { const n = new Set(c); if (n.has(s.index)) n.delete(s.index); else n.add(s.index); return n; })} /> <strong>{s.headline}</strong></label>
                  {s.subtitle && <p className="fine-print"><em>{s.subtitle}</em></p>}
                  <p className="fine-print">By {s.byline || '?'}{s.reporter ? '' : ' (not on the staff list)'} · {s.reliability ? RELIABILITY[s.reliability].label : 'no reliability'} · {s.suggestedAt ? formatInZone(s.suggestedAt, file.zone) : 'no time given'}</p>
                  {s.problems.map((p) => <p key={p} className="form-error">{p}</p>)}
                  {file.dup.has(s.index) && <p className="form-error">Duplicate: {file.dup.get(s.index)} It will not be imported.</p>}
                  {!blocked && (
                    <label>Section
                      <select value={section[s.index] ?? ''} onChange={(ev) => setSection({ ...section, [s.index]: ev.target.value as NewsSection })}>
                        <option value="">Choose a section</option>
                        {SECTIONS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                      </select>
                    </label>
                  )}
                  <button type="button" className="button small secondary" aria-expanded={open === s.index} onClick={() => setOpen(open === s.index ? null : s.index)}>{open === s.index ? 'Hide text' : 'Show text'}</button>
                  {open === s.index && <div className="gz-import-text"><Markdown text={s.body} /></div>}
                </li>
              );
            })}
          </ul>
          {chosen.length > 0 && missingSection.length > 0 && <p className="fine-print">Choose a section for {missingSection.length === 1 ? 'one story' : `${missingSection.length} stories`}.</p>}
          <button type="button" className="button" disabled={busy || chosen.length === 0 || missingSection.length > 0} onClick={() => void add()}>
            {busy ? 'Adding…' : `Add ${chosen.length} ${chosen.length === 1 ? 'story' : 'stories'} for approval`}
          </button>
        </>
      )}
    </details>
  );
}

function NewsProposals({ onDone }: { onDone: (message: string) => void }) {
  const navigate = useNavigate();
  const proposals = useLoad(async () => ({ list: await listNewsProposals(), zone: await getCampaignZone() }), []);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  // The batch: which proposals are chosen, how each one is handled, and what the DM has read.
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [read, setRead] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<Record<string, 'schedule' | 'print' | 'hold'>>({});
  const [when, setWhen] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState(false);
  // When the panel was loaded; the click re-checks the real time, and the database refuses a past time anyway.
  const [now] = useState(() => Date.now());
  const zone = proposals.data?.zone ?? 'UTC';
  const pending = proposals.data?.list ?? [];
  if (!proposals.loading && pending.length === 0 && !proposals.error) return null;
  // A suggestion in the future is the default; one that has passed is never used silently.
  const modeOf = (p: NewsProposal) => mode[p.id] ?? (p.suggested_publish_at && new Date(p.suggested_publish_at).getTime() > now ? 'schedule' : 'hold');
  const whenOf = (p: NewsProposal) => when[p.id] ?? (p.suggested_publish_at ? utcToZoned(p.suggested_publish_at, zone) : '');
  const picked = pending.filter((p) => chosen.has(p.id));
  const unread = picked.filter((p) => !read.has(p.id));
  const instants = new Map(picked.map((p) => [p.id, modeOf(p) === 'schedule' ? zonedToUtc(whenOf(p), zone) : null]));
  const badTime = picked.filter((p) => modeOf(p) === 'schedule' && !(instants.get(p.id)!.getTime() > now));
  const ready = picked.length > 0 && unread.length === 0 && badTime.length === 0 && confirmed;
  const toggle = (id: string) => { setConfirmed(false); setChosen((c) => { const n = new Set(c); if (n.has(id)) n.delete(id); else n.add(id); return n; }); };
  const openStory = (id: string) => { setOpen(open === id ? null : id); setRead((r) => new Set(r).add(id)); };

  async function decide(id: string, accept: boolean) {
    setBusy(id); setError('');
    try {
      if (accept) {
        const saved = await acceptNewsProposal(id);
        navigate(`/dm/news/edit/${saved.slug}`);
        return;
      }
      if (!window.confirm('Dismiss this proposal? It is not saved anywhere else.')) return;
      await dismissNewsProposal(id);
      proposals.reload();
    } catch (e) {
      setError(e instanceof Error ? `That did not work: ${e.message}` : 'That did not work. Try again.');
    } finally {
      setBusy('');
    }
  }
  async function approveBatch() {
    if (!ready || busy) return;
    if (picked.some((p) => modeOf(p) === 'schedule' && !(instants.get(p.id)!.getTime() > Date.now()))) { setError('A chosen time has passed. Choose a new time, or print it now.'); return; }
    const printNow = picked.filter((p) => modeOf(p) === 'print');
    if (printNow.length > 0 && !window.confirm(`Print ${printNow.length} ${printNow.length === 1 ? 'story' : 'stories'} for players right now? They will be visible at once.`)) return;
    setBusy('batch'); setError('');
    try {
      const done = await scheduleNewsProposals(picked.map((p) => ({
        id: p.id, at: modeOf(p) === 'schedule' ? instants.get(p.id)!.toISOString() : null, print_now: modeOf(p) === 'print',
      })));
      const n = (state: string) => done.filter((d) => d.state === state).length;
      setChosen(new Set()); setRead(new Set()); setConfirmed(false);
      proposals.reload();
      onDone(`Approved ${done.length}: ${n('scheduled')} scheduled, ${n('printed')} printed now, ${n('approved')} approved and waiting. Players see nothing until a story’s time comes.`);
    } catch (e) {
      setError(e instanceof Error ? `Nothing was changed. ${e.message}` : 'Nothing was changed. Try again.');
    } finally {
      setBusy('');
    }
  }
  return (
    <section className="panel gz-proposals" id="proposals" aria-labelledby="gz-proposals-title">
      <h2 id="gz-proposals-title">Waiting for your approval</h2>
      <p className="fine-print">Stories filed by an assistant or imported from a Gazette package. Nothing here is a story yet. Read each one, tick the ones you want, and approve them together: they are accepted, approved and scheduled in one step, at the times below ({zone}). Assistants can propose and suggest a time; only you can approve and schedule. Nothing is printed unless you choose to.</p>
      {proposals.error && <p className="form-error" role="alert">{proposals.error}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <ul className="gz-proposal-list">
        {pending.map((p) => {
          const isChosen = chosen.has(p.id);
          const suggestedPast = p.suggested_publish_at !== null && new Date(p.suggested_publish_at).getTime() <= now;
          return (
            <li key={p.id} className="gz-proposal" data-testid="news-proposal">
              <div className="gz-proposal-head">
                <label className="checkbox"><input type="checkbox" checked={isChosen} onChange={() => toggle(p.id)} aria-label={`Choose “${p.title}”`} /> <strong>{p.title}</strong></label>{' '}
                <Stamp reliability={p.reliability} />
                <span className="muted fine-print"> · {sectionLabel(p.section)} · {reporter(p.reporter).name}, {reporter(p.reporter).title} · {p.created_via === 'web' ? `imported by the DM ${new Date(p.created_at).toLocaleDateString()}` : `filed ${new Date(p.created_at).toLocaleDateString()} by an assistant (${p.created_via})`}</span>
              </div>
              <p className="fine-print">
                {p.suggested_publish_at ? <>Suggested time: <strong>{formatInZone(p.suggested_publish_at, zone)}</strong>{suggestedPast && <span className="gz-late"> · this time has passed</span>}</> : 'No time suggested.'}
                {' '}{read.has(p.id) ? '· Read.' : '· Not read yet.'}
              </p>
              {p.warnings.length > 0 && <ul className="fine-print form-error">{p.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
              {p.based_on.length > 0 && <p className="fine-print">Based on: {p.based_on.map((slug, i) => <span key={slug}>{i > 0 && ', '}<Link to={`/wiki/${slug}`}>{slug}</Link></span>)}</p>}
              {open === p.id && (
                <StoryView title={p.title} kicker="" deck={p.subtitle} summary={p.summary} body={p.body} related={[]} heroMediaId={null}
                  details={{ section: p.section, reliability: p.reliability, reporter: p.reporter, dateline: p.dateline, in_world_date: p.in_world_date, issue_number: null, is_lead: false, corrects_article_id: null, review_state: 'draft', reviewed_at: null }} />
              )}
              {isChosen && (
                <div className="gz-proposal-plan">
                  <label>What happens
                    <select value={modeOf(p)} onChange={(ev) => { setConfirmed(false); setMode({ ...mode, [p.id]: ev.target.value as 'schedule' | 'print' | 'hold' }); }}>
                      <option value="schedule">Schedule for the time below</option>
                      <option value="print">Print now (players see it at once)</option>
                      <option value="hold">Approve only (no time yet)</option>
                    </select>
                  </label>
                  {modeOf(p) === 'schedule' && (
                    <label>Release on ({zone})
                      <input type="datetime-local" step={300} value={whenOf(p)} onChange={(ev) => { setConfirmed(false); setWhen({ ...when, [p.id]: ev.target.value }); }} />
                    </label>
                  )}
                  {badTime.includes(p) && <p className="form-error" role="alert">Choose a time in the future, or print it now.</p>}
                  {suggestedPast && modeOf(p) !== 'print' && <p className="fine-print">The suggested time has passed. Pick a new time, or choose Print now.</p>}
                </div>
              )}
              <div className="row-wrap">
                <button type="button" className="button small secondary" aria-expanded={open === p.id} onClick={() => openStory(p.id)}>{open === p.id ? 'Hide' : 'Read it'}</button>
                <button type="button" className="button small secondary" disabled={busy !== ''} onClick={() => void decide(p.id, true)}>{busy === p.id ? 'Saving…' : 'Accept as a private draft'}</button>
                <button type="button" className="button small secondary" disabled={busy !== ''} onClick={() => void decide(p.id, false)}>Dismiss</button>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="gz-batch" role="group" aria-label="Approve the chosen stories">
        <p>
          <strong>{picked.length}</strong> chosen
          {pending.length > 1 && <> · <button type="button" className="link-button" onClick={() => { setConfirmed(false); setChosen(new Set(pending.map((x) => x.id))); }}>Choose all</button> · <button type="button" className="link-button" onClick={() => { setConfirmed(false); setChosen(new Set()); }}>Clear</button></>}
        </p>
        {unread.length > 0 && <p className="fine-print">Read every chosen story first (“Read it”): {unread.length} not read yet.</p>}
        <label className="checkbox">
          <input type="checkbox" checked={confirmed} disabled={picked.length === 0 || unread.length > 0} onChange={(ev) => setConfirmed(ev.target.checked)} />
          {' '}I have read {picked.length === 1 ? 'this story' : `these ${picked.length} stories`} in full and approve {picked.length === 1 ? 'it' : 'them'} for the Gazette.
        </label>
        <button type="button" className="button" disabled={!ready || busy !== ''} onClick={() => void approveBatch()}>
          {busy === 'batch' ? 'Approving…' : `Accept, approve and schedule ${picked.length || ''}`.trim()}
        </button>
      </div>
    </section>
  );
}

type DeskStory = NewsStory & { pendingState: NewsReviewState | null; pendingAt: string | null; scheduledAt: string | null };
function DeskTable({ stories, busy, act, zone, onScheduled }: { stories: DeskStory[]; busy: string; act: (id: string, a: NewsAction) => void; zone: string; onScheduled: (m: string) => void }) {
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
                <td>{printed ? 'Printed' : s.scheduledAt ? <>Scheduled<br /><span className="fine-print">{formatInZone(s.scheduledAt, zone)}</span></> : REVIEW_LABEL[state]}{printed && s.pendingState && <><br /><span className="badge badge-dm">Revision: {REVIEW_LABEL[s.pendingState]}</span></>}</td>
                <td>
                  <StoryActions id={s.id} state={state} printed={printed} pending={s.pendingState} busy={busy === s.id} act={act} />
                  {!printed && state === 'approved' && <ScheduleControl compact id={s.id} version={s.version} scheduledAt={s.scheduledAt} zone={zone} disabled={busy === s.id} onDone={onScheduled} />}
                </td>
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
  letter_from: '', letter_to: '', letter_signature: '',
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
  const sched = useLoad(async () => ({ at: e ? (await listScheduled()).get(e.bundle.article.id) ?? null : null, zone: await getCampaignZone() }), [e?.bundle.article.id, e?.bundle.article.version]);
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
  const [dirty, setDirty] = useState(false);
  const set = (patch: Partial<typeof form>) => { setDirty(true); setForm((f) => ({ ...f, ...patch })); };
  const setD = (patch: Partial<NewsDraft['details']>) => { setDirty(true); setForm((f) => ({ ...f, details: { ...f.details, ...patch } })); };
  useUnsavedGuard(dirty && !busy);

  async function save(ev: FormEvent) {
    ev.preventDefault();
    if (busy) return; // a double tap must not save twice
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
      setDirty(false);
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
    // Review and printing act on the saved text, never on what is only on screen.
    if (dirty) {
      setMessage({ ok: false, text: 'Save your changes first. Review and printing use the saved story, not the text on screen.' });
      return;
    }
    setBusy(true); setMessage(null);
    try {
      const r = await newsTransition(e.bundle.article.id, action, { version: e.bundle.article.version, revision: e.pending?.updated_at ?? null });
      setFlash(action === 'approve' && printed ? 'Revision approved: players now read the new version.'
        : action === 'discard' ? 'Revision discarded: the printed version is unchanged.'
        : action === 'submit' && printed ? 'Revision sent for review. Players still see the printed version.'
        : r.status === 'published' ? 'Printed: players can now read this story.'
        : action === 'unpublish' || action === 'return' ? 'Taken out of the paper: players can no longer see it.'
        : `Now: ${REVIEW_LABEL[r.review_state]}.`);
      reload();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof ChronicleError && err.code === 'CONFLICT'
        ? 'This story was changed somewhere else since you opened it, so nothing was done. Reload the page to read the current text.'
        : err instanceof Error ? err.message : 'Could not change the story.' });
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
          {!printed && state === 'approved' && sched.data && !dirty && (
            <ScheduleControl id={e.bundle.article.id} version={e.bundle.article.version} scheduledAt={sched.data.at} zone={sched.data.zone} disabled={busy}
              onDone={(m) => { setFlash(m); reload(); sched.reload(); }} />
          )}
          {dirty && <p className="fine-print gz-unsaved" role="status"><span className="badge badge-draft">Unsaved changes</span> Save before sending for review, approving or printing.</p>}
        </section>
      )}
      {message && <p className={message.ok ? 'form-ok' : 'form-error'} role={message.ok ? 'status' : 'alert'}>{message.text}</p>}

      {preview ? (
        isLetter(details)
          ? <LetterView title={form.title} body={[form.summary, form.body].filter(Boolean).join('\n\n')} details={details} heroMediaId={form.heroMediaId} />
          : <StoryView title={form.title} kicker="" deck={form.subtitle} summary={form.summary} body={form.body} details={details} related={[]} heroMediaId={form.heroMediaId} />
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
              <option value="letters">Letter from Krynn (not a newspaper story)</option>
            </select>
          </label>
          {isLetter(form.details) && (
            <>
              <label>Letter from (sender)
                <input value={form.details.letter_from ?? ''} maxLength={120} placeholder="e.g. the person writing" onChange={(ev) => setD({ letter_from: ev.target.value })} />
              </label>
              <label>Letter to (recipient)
                <input value={form.details.letter_to ?? ''} maxLength={120} placeholder="e.g. the party" onChange={(ev) => setD({ letter_to: ev.target.value })} />
              </label>
              <label className="span-2">Signature (optional)
                <input value={form.details.letter_signature ?? ''} maxLength={200} onChange={(ev) => setD({ letter_signature: ev.target.value })} />
                <span className="fine-print">The headline is the subject line; the dateline is the place it was written; the in-world date is its date. Only write what the party could know.</span>
              </label>
            </>
          )}
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
            <span className="fine-print">Markdown. Link Chronicle pages with [[page-address]] or [[page-address|shown text]]; they appear under “In the Chronicle”. Use <strong>Add photo</strong> for pictures. Only write what players may know: printing makes the whole story public to them.</span>
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
