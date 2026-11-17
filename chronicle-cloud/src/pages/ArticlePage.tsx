import { useEffect } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { ClueFinds } from '../components/Clues.tsx';
import { ScratchpadPanel } from '../components/Scratchpad.tsx';
import { recordRecentView } from '../lib/recentViews.ts';
import { LightboxProvider } from '../components/Lightbox.tsx';
import { CharacterProfile, EncyclopediaPage, SessionJournal } from './ArticleViews.tsx';
import { getArticle, previewAsPlayer, resolveSlug, type ArticleBundle } from '../lib/api.ts';
import { useIsDm, useSession } from '../lib/session.tsx';
import type { ArticleRef, ArticleType, Visibility } from '../lib/types.ts';
import { useLoad } from '../lib/useLoad.ts';
import { NotFound } from './NotFound.tsx';

export interface ViewModel {
  id: string;
  slug: string;
  type: ArticleType;
  title: string;
  subtitle: string;
  summary: string;
  heroMediaId: string | null;
  updatedAt: string;
  sessionDate?: string | null;
  isPartyMember?: boolean;
  status?: ArticleBundle['article']['status'];
  visibility?: Visibility;
  sections: { id: string; heading: string; body: string; visibility?: Visibility; status?: ArticleBundle['article']['status'] }[];
  infobox: { label: string; value: string; visibility?: Visibility }[];
  categories: { slug: string; name: string; kind: string; visibility?: Visibility }[];
  relations: { key: string; kind: string; label: string; other: ArticleRef; visibility?: Visibility; direction?: 'out' | 'in' }[];
  backlinks: ArticleRef[];
  /** The DM's "preview as player" view, built from a function rather than the table rows. */
  previewing?: boolean;
}

function fromBundle(b: ArticleBundle): ViewModel {
  return {
    id: b.article.id, slug: b.article.slug, type: b.article.type, title: b.article.title, subtitle: b.article.subtitle,
    summary: b.article.summary, heroMediaId: b.article.hero_media_id, updatedAt: b.article.updated_at,
    sessionDate: b.article.session_date, isPartyMember: b.article.is_party_member,
    status: b.article.status, visibility: b.article.visibility,
    sections: b.sections,
    infobox: b.infobox,
    categories: b.categories,
    relations: b.relations.map((r) => ({ key: r.id, kind: r.kind, label: r.label, other: r.other, visibility: r.visibility, direction: r.direction })),
    backlinks: b.backlinks,
  };
}

export function ArticlePage() {
  const { slug = '' } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const isDm = useIsDm();
  const { playerPreview, state } = useSession();
  const userId = state.kind === 'member' ? state.userId : '';

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
        previewing: true,
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
    // Gazette stories have their own newspaper page.
    else if (data && data.type === 'news' && !playerPreview) navigate(`/news/${data.slug}`, { replace: true });
  }, [data, navigate, slug, playerPreview]);
  useEffect(() => {
    if (data && !('redirect' in data)) document.title = `${data.title} · Chronicle`;
  }, [data]);

  const viewed = data && !('redirect' in data) ? data : null;
  useEffect(() => {
    // Recently viewed lives in this browser only, per signed-in user (see lib/recentViews.ts).
    if (viewed && userId && !playerPreview && viewed.type !== 'news') recordRecentView(userId, { id: viewed.id, slug: viewed.slug, title: viewed.title });
  }, [viewed?.id, viewed?.slug, viewed?.title, viewed?.type, userId, playerPreview]); // eslint-disable-line react-hooks/exhaustive-deps

  if (page.error) return <p className="form-error">{page.error}</p>;
  if (page.loading && !data) return <p className="muted">Loading…</p>;
  if (!data) return <NotFound what="article" />;
  if ('redirect' in data) return null;

  // A heading with nothing under it is noise for readers; the editor still shows it.
  const v = { ...data, sections: data.sections.filter((x) => x.body.trim()) };
  const from = params.get('from');
  // One viewer for the whole article body, so it steps through every picture on the page.
  return (
    <LightboxProvider>
      {v.type === 'character' ? <CharacterProfile v={v} isDm={isDm} from={from} />
        : v.type === 'session' ? <SessionJournal v={v} isDm={isDm} from={from} />
        : <EncyclopediaPage v={v} isDm={isDm} from={from} />}
      {v.type !== 'news' && <ClueFinds attach="article" id={v.id} />}
      {!playerPreview && v.type !== 'news' && <ScratchpadPanel key={v.id} articleId={v.id} />}
    </LightboxProvider>
  );
}
