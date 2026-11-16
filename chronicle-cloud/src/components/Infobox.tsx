import { TEMPLATES } from '../lib/templates.ts';
import type { ArticleType, Visibility } from '../lib/types.ts';
import { Crest } from './Crest.tsx';
import { MediaImage } from './MediaImage.tsx';
import { Markdown } from './Markdown.tsx';
import { VisibilityBadge } from './Badges.tsx';

export interface InfoboxProps {
  title: string;
  type: ArticleType;
  heroMediaId: string | null;
  fields: { label: string; value: string; visibility?: Visibility }[];
  showVisibility: boolean;
}

export function Infobox({ title, type, heroMediaId, fields, showVisibility }: InfoboxProps) {
  return (
    <aside className="infobox" aria-label={`${title} at a glance`}>
      <div className="infobox-title">{title}</div>
      <div className="infobox-image">
        {heroMediaId ? <MediaImage id={heroMediaId} alt={title} /> : <Crest type={type} title={title} size={110} />}
      </div>
      <div className="infobox-kind">{TEMPLATES[type].label}</div>
      {fields.some((f) => f.value.trim()) && (
        <dl>
          {fields.filter((f) => f.value.trim()).map((f, i) => (
            <div key={`${f.label}-${i}`} className={f.visibility === 'dm' ? 'infobox-row dm-only' : 'infobox-row'}>
              <dt>
                {f.label}
                {showVisibility && f.visibility === 'dm' && <VisibilityBadge visibility="dm" />}
              </dt>
              <dd>
                <Markdown text={f.value} />
              </dd>
            </div>
          ))}
        </dl>
      )}
    </aside>
  );
}
