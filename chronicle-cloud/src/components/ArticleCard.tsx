import { Link } from 'react-router';
import { TEMPLATES } from '../lib/templates.ts';
import type { Article } from '../lib/types.ts';
import { StatusBadge, VisibilityBadge } from './Badges.tsx';
import { Crest } from './Crest.tsx';
import { MediaImage } from './MediaImage.tsx';

export function ArticleCard({ article, showState = false, compact = false }: { article: Article; showState?: boolean; compact?: boolean }) {
  return (
    <Link to={`/wiki/${article.slug}`} className={compact ? 'card card-compact' : 'card'}>
      <div className="card-art">
        {article.hero_media_id ? <MediaImage id={article.hero_media_id} alt="" /> : <Crest type={article.type} title={article.title} size={compact ? 44 : 64} />}
      </div>
      <div className="card-body">
        <div className="card-kind">{TEMPLATES[article.type].label}</div>
        <div className="card-title">{article.title}</div>
        {!compact && article.summary && <p className="card-summary">{article.summary}</p>}
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
