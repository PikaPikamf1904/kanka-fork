// How each kind of page reads. One shared vocabulary (sections, connections, footer), three
// treatments: the encyclopedia page, the character profile and the session journal.
import { Link } from 'react-router';
import { StatusBadge, VisibilityBadge } from '../components/Badges.tsx';
import { Crest } from '../components/Crest.tsx';
import { Infobox } from '../components/Infobox.tsx';
import { Markdown } from '../components/Markdown.tsx';
import { MediaImage } from '../components/MediaImage.tsx';
import { sectionAnchor, Toc } from '../components/Toc.tsx';
import { articlesBySlugs, listSessions } from '../lib/api.ts';
import { longDate } from '../lib/dates.ts';
import { splitTimestamp } from '../lib/journal.ts';
import { wikiLinkTargets } from '../lib/slug.ts';
import { relationLabel, TEMPLATES } from '../lib/templates.ts';
import type { ArticleRef, ArticleType } from '../lib/types.ts';
import { useLoad } from '../lib/useLoad.ts';
import type { ViewModel } from './ArticlePage.tsx';

interface ViewProps { v: ViewModel; isDm: boolean; from: string | null }

// ---------- shared pieces ----------

function DmBar({ v, isDm }: { v: ViewModel; isDm: boolean }) {
  if (!isDm) return null;
  return (
    <div className="article-dm-tools">
      {v.status && <StatusBadge status={v.status} />}
      {v.visibility && <VisibilityBadge visibility={v.visibility} />}
      <Link className="button small" to={`/dm/edit/${v.slug}`}>Edit</Link>
    </div>
  );
}

function Sections({ v, isDm, chapter = false }: { v: ViewModel; isDm: boolean; chapter?: boolean }) {
  return (
    <>
      {v.sections.map((s, i) => {
        const hidden = isDm && (s.visibility === 'dm' || s.status === 'draft');
        const { text, source } = splitTimestamp(s.heading);
        const id = sectionAnchor(text, i);
        return (
          <section key={s.id} className={`article-section${chapter ? ' journal-chapter' : ''}${hidden ? ' dm-only' : ''}`} aria-labelledby={text ? id : undefined}>
            {text && (
              <h2 id={id}>
                {text}
                {isDm && s.visibility === 'dm' && <VisibilityBadge visibility="dm" />}
                {isDm && s.status === 'draft' && <StatusBadge status="draft" />}
              </h2>
            )}
            {isDm && source && <p className="source-note" title="Transcript reference, shown to the DM only">Source: transcript {source}</p>}
            <Markdown text={s.body} />
          </section>
        );
      })}
    </>
  );
}

function Connections({ v, isDm }: { v: ViewModel; isDm: boolean }) {
  const byKind = new Map<string, ViewModel['relations']>();
  for (const r of v.relations) byKind.set(r.kind, [...(byKind.get(r.kind) ?? []), r]);
  if (byKind.size === 0) return null;
  return (
    <section className="article-section">
      <h2 id="connections">Connections</h2>
      <dl className="connections">
        {[...byKind.entries()].map(([kind, rels]) => (
          <div key={kind}>
            <dt>{relationLabel(kind)}</dt>
            <dd>
              {rels.map((r, i) => (
                <span key={r.key}>
                  {i > 0 && ', '}
                  <Link to={`/wiki/${r.other.slug}`}>{r.other.title}</Link>
                  {r.label && r.label !== relationLabel(kind) && <span className="muted"> ({r.label})</span>}
                  {isDm && r.visibility === 'dm' && <VisibilityBadge visibility="dm" />}
                </span>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Footer({ v, isDm }: { v: ViewModel; isDm: boolean }) {
  return (
    <footer className="article-footer">
      {v.categories.length > 0 && (
        <div className="category-bar">
          <span className="category-bar-label">Categories:</span>
          {v.categories.map((c) => (
            <Link key={c.slug} to={`/category/${c.slug}`} className={c.kind === 'tag' ? 'chip chip-tag' : 'chip'}>
              {c.name}
              {isDm && c.visibility === 'dm' && ' 🔒'}
            </Link>
          ))}
        </div>
      )}
      <p className="muted">Last updated {longDate(v.updatedAt)}</p>
    </footer>
  );
}

/** Pages this one links to in its text, as far as the reader may see them, grouped by kind. */
function useLinked(v: ViewModel) {
  const text = [v.summary, ...v.sections.map((s) => s.body), ...v.infobox.map((f) => f.value)].join('\n');
  const slugs = wikiLinkTargets(text).filter((x) => x && x !== v.slug);
  const linked = useLoad(() => articlesBySlugs(slugs), [slugs.join(',')]);
  const all = new Map<string, ArticleRef & { hero_media_id?: string | null }>();
  for (const a of linked.data ?? []) all.set(a.slug, a);
  for (const r of v.relations) if (!all.has(r.other.slug)) all.set(r.other.slug, r.other);
  const of = (...types: ArticleType[]) => [...all.values()].filter((a) => types.includes(a.type)).sort((a, b) => a.title.localeCompare(b.title));
  return { of };
}

function LinkList({ title, items }: { title: string; items: ArticleRef[] }) {
  if (items.length === 0) return null;
  return (
    <div className="linked-group">
      <h3>{title}</h3>
      <ul>{items.map((a) => <li key={a.slug}><Link to={`/wiki/${a.slug}`}>{a.title}</Link></li>)}</ul>
    </div>
  );
}

function Backlinks({ items, title = 'What links here', id = 'what-links-here' }: { items: ArticleRef[]; title?: string; id?: string }) {
  if (items.length === 0) return null;
  return (
    <section className="article-section what-links-here">
      <h2 id={id}>{title}</h2>
      <ul>
        {items.map((b) => (
          <li key={b.slug}><Link to={b.type === 'news' ? `/news/${b.slug}` : `/wiki/${b.slug}`}>{b.title}</Link> <span className="muted">· {TEMPLATES[b.type]?.label ?? b.type}</span></li>
        ))}
      </ul>
    </section>
  );
}

// ---------- the encyclopedia page (places, factions, items, quests, lore, events) ----------

export function EncyclopediaPage({ v, isDm, from }: ViewProps) {
  return (
    <article className={`article article-type-${v.type}`}>
      <div className="article-meta-top">
        <Link to={`/browse/${v.type}`} className="article-kind"><span aria-hidden="true">{TEMPLATES[v.type].glyph} </span>{TEMPLATES[v.type].plural}</Link>
        <DmBar v={v} isDm={isDm} />
      </div>
      <h1 className="article-title">{v.title}</h1>
      {v.subtitle && <p className="article-subtitle">{v.subtitle}</p>}
      {from && <p className="redirect-note">(Redirected from {from})</p>}
      <div className="article-layout">
        <Infobox title={v.title} type={v.type} heroMediaId={v.heroMediaId} fields={v.infobox} showVisibility={isDm} />
        <div className="article-body">
          {v.summary && <div className="article-lead"><Markdown text={v.summary} /></div>}
          <Toc headings={v.sections.map((s) => splitTimestamp(s.heading).text)} />
          <Sections v={v} isDm={isDm} />
          <Connections v={v} isDm={isDm} />
          <Backlinks items={v.backlinks} />
          <Footer v={v} isDm={isDm} />
        </div>
      </div>
    </article>
  );
}

// ---------- the character profile ----------

const FACT_KEYS: [string, string[]][] = [
  ['species', ['species', 'race', 'ancestry']],
  ['class', ['class', 'classes']],
  ['level', ['level']],
  ['status', ['status', 'condition']],
];
function factsOf(v: ViewModel) {
  const out: Record<string, string> = {};
  for (const [key, labels] of FACT_KEYS) {
    const f = v.infobox.find((x) => labels.includes(x.label.trim().toLowerCase()) && x.value.trim());
    if (f) out[key] = f.value.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2').replace(/\[\[([^\]]+)\]\]/g, '$1').trim();
  }
  return out;
}

export function CharacterProfile({ v, isDm, from }: ViewProps) {
  const facts = factsOf(v);
  const linked = useLinked(v);
  const sessions = useLoad(listSessions, []);
  const order = new Map((sessions.data ?? []).map((s, i) => [s.slug, i]));
  const journals = v.backlinks.filter((b) => b.type === 'session').sort((a, b) => (order.get(a.slug) ?? 0) - (order.get(b.slug) ?? 0));
  const others = v.backlinks.filter((b) => b.type !== 'session');
  const places = linked.of('location');
  const events = linked.of('event', 'quest');
  const isParty = v.isPartyMember === true;
  const factLine = [facts.species, facts.class, facts.level].filter(Boolean);
  return (
    <article className="article article-character">
      <div className="article-meta-top">
        <Link to="/browse/character" className="article-kind"><span aria-hidden="true">{TEMPLATES.character.glyph} </span>Characters</Link>
        <DmBar v={v} isDm={isDm} />
      </div>
      <header className="profile-header">
        <div className={v.heroMediaId ? 'profile-portrait' : 'profile-portrait profile-portrait-empty'}>
          {v.heroMediaId ? <MediaImage id={v.heroMediaId} alt={`Portrait of ${v.title}`} /> : (
            <>
              <Crest type="character" title={v.title} size={120} />
              <span className="profile-portrait-note">No portrait yet</span>
            </>
          )}
        </div>
        <div className="profile-heading">
          <h1 className="article-title">{v.title}</h1>
          {v.subtitle && <p className="article-subtitle">{v.subtitle}</p>}
          {from && <p className="redirect-note">(Redirected from {from})</p>}
          {factLine.length > 0 && <p className="profile-facts">{factLine.join(' · ')}</p>}
          <p className="profile-chips">
            {isParty && <span className="chip chip-party">Of the party</span>}
            {facts.status && <span className="chip">{facts.status}</span>}
          </p>
        </div>
      </header>

      <nav className="character-page-nav" aria-label="On this character page">
        <span className="character-page-nav-label">On this page</span>
        {v.summary && <a href="#character-overview">Overview</a>}
        {v.sections.map((section, i) => {
          const t = splitTimestamp(section.heading).text;
          return t ? <a key={section.id} href={`#${sectionAnchor(t, i)}`}>{t}</a> : null;
        })}
        {v.relations.length > 0 && <a href="#connections">Connections</a>}
        {journals.length > 0 && <a href="#character-journals">Session journals</a>}
      </nav>

      <div className="profile-layout">
        <div className="article-body">
          {v.summary && <div className="article-lead" id="character-overview"><Markdown text={v.summary} /></div>}
          <Sections v={v} isDm={isDm} />
          <Connections v={v} isDm={isDm} />
          {journals.length > 0 && (
            <section className="article-section character-journals">
              <h2 id="character-journals">In the session journals</h2>
              <ol className="journal-trail">
                {journals.map((b) => (
                  <li key={b.slug}><Link to={`/wiki/${b.slug}`}>{b.title}</Link></li>
                ))}
              </ol>
            </section>
          )}
          <Backlinks items={others} title="Other mentions" />
          <Footer v={v} isDm={isDm} />
        </div>
        <div className="profile-side">
          <Infobox title={v.title} type={v.type} heroMediaId={null} fields={v.infobox} showVisibility={isDm} />
          {(places.length > 0 || events.length > 0) && (
            <aside className="panel linked-panel" aria-label="Places and events">
              <LinkList title="Places" items={places} />
              <LinkList title="Events and quests" items={events} />
            </aside>
          )}
        </div>
      </div>
    </article>
  );
}

// ---------- the session journal ----------

export function SessionJournal({ v, isDm, from }: ViewProps) {
  const linked = useLinked(v);
  const sessions = useLoad(listSessions, []);
  const list = sessions.data ?? [];
  const at = list.findIndex((s) => s.slug === v.slug);
  const prev = at > 0 ? list[at - 1] : null;
  const next = at >= 0 && at < list.length - 1 ? list[at + 1] : null;
  const playDate = v.infobox.find((f) => /^(date|played|play date|session date)$/i.test(f.label.trim()))?.value;
  const characters = linked.of('character');
  const places = linked.of('location');
  const things = linked.of('item', 'quest', 'event', 'faction');
  return (
    <article className="article article-journal">
      <div className="article-meta-top">
        <Link to="/browse/session" className="article-kind"><span aria-hidden="true">{TEMPLATES.session.glyph} </span>Session journals</Link>
        <DmBar v={v} isDm={isDm} />
      </div>
      <header className="journal-header">
        <p className="journal-number">{at >= 0 ? `Session ${at + 1} of ${list.length}` : 'Session journal'}{(v.sessionDate || playDate) && <> · <span>{longDate(v.sessionDate ?? '') || playDate}</span></>}</p>
        <h1 className="article-title">{v.title}</h1>
        {v.subtitle && <p className="article-subtitle">{v.subtitle}</p>}
        {from && <p className="redirect-note">(Redirected from {from})</p>}
      </header>
      {v.summary && (
        <div className="journal-recap">
          <h2 className="visually-hidden">In short</h2>
          <Markdown text={v.summary} />
        </div>
      )}
      <div className="journal-layout">
        <div className="article-body journal-body">
          <Toc headings={v.sections.map((s) => splitTimestamp(s.heading).text)} />
          <Sections v={v} isDm={isDm} chapter />
          <Connections v={v} isDm={isDm} />
          <nav className="journal-pager" aria-label="Neighbouring sessions">
            {prev ? <Link to={`/wiki/${prev.slug}`} className="journal-prev"><span className="muted">Previous session</span><span>{prev.title}</span></Link> : <span />}
            {next ? <Link to={`/wiki/${next.slug}`} className="journal-next"><span className="muted">Next session</span><span>{next.title}</span></Link> : <span />}
          </nav>
          <Footer v={v} isDm={isDm} />
        </div>
        {(characters.length + places.length + things.length > 0 || v.infobox.length > 0) && (
          <aside className="journal-side" aria-label="Who, where and what">
            <div className="panel">
              <h2>At the table</h2>
              <LinkList title="Characters" items={characters} />
              <LinkList title="Places" items={places} />
              <LinkList title="Quests, items and more" items={things} />
              {v.infobox.filter((f) => f.value.trim()).length > 0 && (
                <dl className="journal-facts">
                  {v.infobox.filter((f) => f.value.trim()).map((f, i) => (
                    <div key={`${f.label}-${i}`}><dt>{f.label}{isDm && f.visibility === 'dm' && <VisibilityBadge visibility="dm" />}</dt><dd><Markdown text={f.value} /></dd></div>
                  ))}
                </dl>
              )}
            </div>
          </aside>
        )}
      </div>
    </article>
  );
}
