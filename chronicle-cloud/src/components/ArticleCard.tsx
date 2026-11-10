import { Link } from 'react-router';
import { TEMPLATES } from '../lib/templates.ts';
import type { Article } from '../lib/types.ts';
import { StatusBadge, VisibilityBadge } from './Badges.tsx';
import { Crest } from './Crest.tsx';
import { MediaImage } from './MediaImage.tsx';

export function ArticleCard({ article, showState = false, compact = false, portrait = false, meta, badge }: {
  article: Article; showState?: boolean; compact?: boolean;
  /** Large 3:4 picture on top (character directory). */
  portrait?: boolean;
  /** One line of known facts under the title, e.g. "Gnome · Artificer". Omitted when empty. */
  meta?: string;
  badge?: string;
}) {
  return (
    <Link to={`/wiki/${article.slug}`} className={compact ? 'card card-compact' : portrait ? 'card card-portrait' : 'card'}>
      <div className="card-art">
        {article.hero_media_id ? <MediaImage id={article.hero_media_id} alt="" /> : <Crest type={article.type} title={article.title} size={compact ? 44 : portrait ? 96 : 64} />}
      </div>
      <div className="card-body">
        <div className="card-kind">{TEMPLATES[article.type].label}</div>
        <div className="card-title">{article.title}</div>
        {meta && <div className="card-meta">{meta}</div>}
        {!compact && article.summary && <p className="card-summary">{article.summary}</p>}
        {badge && <div className="card-badges"><span className="badge badge-party">{badge}</span></div>}
        {showState && (article.status !== 'published' || article.visibility !== 'players') && (
          <div className="card-badges">
            {article.status !== 'published' && <StatusBadge status={article.status} />}
            {article.visibility !== 'players' && <VisibilityBadge visibility={article.visibility} />}
          </div>
        )}
      </div>
    </Link>
  );
}
