import { TEMPLATES } from '../lib/templates.ts';
import type { ArticleType } from '../lib/types.ts';

const HUES: Record<ArticleType, number> = {
  character: 222, location: 150, faction: 2, item: 38, quest: 280, session: 195, event: 20, dossier: 340, lore: 60, news: 100,
};

/** An original heraldic placeholder used when an entry has no artwork. */
export function Crest({ type, title, size = 96 }: { type: ArticleType; title: string; size?: number }) {
  const hue = HUES[type];
  const initial = title.trim().charAt(0).toUpperCase() || '?';
  return (
    <svg className="crest" width={size} height={size * 1.15} viewBox="0 0 100 115" role="img" aria-label={`${TEMPLATES[type].label} crest`}>
      <defs>
        <linearGradient id={`crest-${type}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={`hsl(${hue} 45% 34%)`} />
          <stop offset="1" stopColor={`hsl(${hue} 50% 18%)`} />
        </linearGradient>
      </defs>
      <path d="M50 3 L95 15 V55 C95 85 72 102 50 112 C28 102 5 85 5 55 V15 Z" fill={`url(#crest-${type})`} stroke="var(--gold)" strokeWidth="3" />
      <path d="M50 11 L87 21 V55 C87 80 68 95 50 103 C32 95 13 80 13 55 V21 Z" fill="none" stroke="var(--gold)" strokeOpacity="0.45" strokeWidth="1.2" />
      <text x="50" y="62" textAnchor="middle" fontFamily="Cinzel, serif" fontSize="38" fill="var(--gold-light)">{initial}</text>
      <text x="50" y="88" textAnchor="middle" fontSize="16" fill="var(--gold-light)" fillOpacity="0.8">{TEMPLATES[type].glyph}</text>
    </svg>
  );
}
