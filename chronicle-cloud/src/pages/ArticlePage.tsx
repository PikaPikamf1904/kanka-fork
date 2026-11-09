import { useEffect } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { StatusBadge, VisibilityBadge } from '../components/Badges.tsx';
import { Infobox } from '../components/Infobox.tsx';
import { Markdown } from '../components/Markdown.tsx';
import { sectionAnchor, Toc } from '../components/Toc.tsx';
import { getArticle, previewAsPlayer, resolveSlug, type ArticleBundle } from '../lib/api.ts';
import { useIsDm, useSession } from '../lib/session.tsx';
import { relationLabel, TEMPLATES } from '../lib/templates.ts';
import type { ArticleRef, ArticleType, Visibility } from '../lib/types.ts';
import { useLoad } from '../lib/useLoad.ts';
import { NotFound } from './NotFound.tsx';

interface ViewModel {
  id: string;
  slug: string;
  type: ArticleType;
  title: string;
  subtitle: string;
  summary: string;
  heroMediaId: string | null;
  updatedAt: string;
  status?: ArticleBundle['article']['status'];
  visibility?: Visibility;
  sections: { id: string; heading: string; body: string; visibility?: Visibility; status?: ArticleBundle['article']['status'] }[];
  infobox: { label: string; value: string; visibility?: Visibility }[];
  categories: { slug: string; name: string; kind: string; visibility?: Visibility }[];
  relations: { key: string; kind: string; label: string; other: ArticleRef; visibility?: Visibility }[];
  backlinks: ArticleRef[];
}

function fromBundle(b: ArticleBundle): ViewModel {
  return {
    id: b.article.id, slug: b.article.slug, type: b.article.type, title: b.article.title, subtitle: b.article.subtitle,
    summary: b.article.summary, heroMediaId: b.article.hero_media_id, updatedAt: b.article.updated_at,
    status: b.article.status, visibility: b.article.visibility,
    sections: b.sections,
    infobox: b.infobox,
    categories: b.categories,
    relations: b.relations.map((r) => ({ key: r.id, kind: r.kind, label: r.label, other: r.other, visibility: r.visibility })),
    backlinks: b.backlinks,
  };
}

export function ArticlePage() {
  const { slug = '' } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const isDm = useIsDm();
  const { playerPreview } = useSession();

  const page = useLoad(async (): Promise<ViewModel | null | { redirect: string }> => {
    if (playerPreview) {
      const p = await previewAsPlayer(slug);
      if (!p.visible || !p.article) return null;
      return {
        id: p.article.id, slug: p.article.slug, type: p.article.type, title: p.article.title, subtitle: p.article.subtitle,
        summary: p.article.summary, heroMediaId: p.article.hero_media_id, updatedAt: p.article.updated_at,
        sections: p.sections ?? [],
        infobox: p.infobox ?? [],
        categories: p.categories ?? [],
        relations: (p.relations ?? []).map((r, i) => ({ key: `${r.slug}-${i}`, kind: r.kind, label: r.label, other: { slug: r.slug, title: r.title, type: 'lore' as ArticleType } })),
        // Backlinks are not part of the preview function; hide them rather than show DM-visible ones.
        backlinks: [],
      };
    }
    const bundle = await getArticle(slug);
    if (bundle) return fromBundle(bundle);
    const resolved = await resolveSlug(slug);
    if (resolved && resolved.slug !== slug) return { redirect: resolved.slug };
    return null;
  }, [slug, playerPreview]);

  const data = page.data;
  useEffect(() => {
    if (data && 'redirect' in data) navigate(`/wiki/${data.redirect}?from=${encodeURIComponent(slug)}`, { replace: true });
  }, [data, navigate, slug]);
  useEffect(() => {
    if (data && !('redirect' in data)) document.title = `${data.title} · Chronicle`;
  }, [data]);

  if (page.error) return <p className="form-error">{page.error}</p>;
  if (page.loading && !data) return <p className="muted">Loading…</p>;
  if (!data) return <NotFound what="article" />;
  if ('redirect' in data) return null;

  const v = data;
  const from = params.get('from');
  const relationsByKind = new Map<string, ViewModel['relations']>();
  for (const r of v.relations) relationsByKind.set(r.kind, [...(relationsByKind.get(r.kind) ?? []), r]);

  return (
    <article className="article">
      <div className="article-meta-top">
        <Link to={`/browse/${v.type}`} className="article-kind">{TEMPLATES[v.type].plural}</Link>
        {isDm && (
          <div className="article-dm-tools">
            {v.status && <StatusBadge status={v.status} />}
            {v.visibility && <VisibilityBadge visibility={v.visibility} />}
            <Link className="button small" to={`/dm/edit/${v.slug}`}>Edit</Link>
          </div>
        )}
      </div>
      <h1 className="article-title">{v.title}</h1>
      {v.subtitle && <p className="article-subtitle">{v.subtitle}</p>}
      {from && <p className="redirect-note">(Redirected from {from})</p>}

      <div className="article-layout">
        <Infobox title={v.title} type={v.type} heroMediaId={v.heroMediaId} fields={v.infobox} showVisibility={isDm} />
        <div className="article-body">
          {v.summary && <p className="article-lead">{v.summary}</p>}
          <Toc headings={v.sections.map((s) => s.heading)} />
          {v.sections.map((s, i) => {
            const hidden = isDm && (s.visibility === 'dm' || s.status === 'draft');
            return (
              <section key={s.id} className={hidden ? 'article-section dm-only' : 'article-section'} aria-labelledby={sectionAnchor(s.heading, i)}>
                {s.heading && (
                  <h2 id={sectionAnchor(s.heading, i)}>
                    {s.heading}
                    {isDm && s.visibility === 'dm' && <VisibilityBadge visibility="dm" />}
                    {isDm && s.status === 'draft' && <StatusBadge status="draft" />}
                  </h2>
                )}
                <Markdown text={s.body} />
              </section>
            );
          })}

          {relationsByKind.size > 0 && (
            <section className="article-section">
              <h2 id="connections">Connections</h2>
              <dl className="connections">
                {[...relationsByKind.entries()].map(([kind, rels]) => (
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
          )}

          {v.backlinks.length > 0 && (
            <section className="article-section what-links-here">
              <h2 id="what-links-here">What links here</h2>
              <ul>
                {v.backlinks.map((b) => (
                  <li key={b.slug}><Link to={`/wiki/${b.slug}`}>{b.title}</Link> <span className="muted">· {TEMPLATES[b.type].label}</span></li>
                ))}
              </ul>
            </section>
          )}

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
            <p className="muted">Last updated {new Date(v.updatedAt).toLocaleString()}</p>
          </footer>
        </div>
      </div>
    </article>
  );
}
