import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router';
import { MediaImage } from '../components/MediaImage.tsx';
import { TEMPLATES } from '../lib/templates.ts';
import { getPreview, type Preview } from './api.ts';

const canHover = () => typeof window !== 'undefined' && window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;
const plain = (md: string) => md.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2').replace(/\[\[([^\]]+)\]\]/g, '$1').replace(/[*_`#>]/g, '').replace(/\s+/g, ' ').trim();

/**
 * A link to a wiki page that shows a small card (picture, type, subtitle, summary) after the
 * pointer rests on it, or when it gets keyboard focus. Touch screens just follow the link.
 */
export function PreviewLink({ to, slug, children }: { to: string; slug: string; children: ReactNode }) {
  const anchor = useRef<HTMLAnchorElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const [card, setCard] = useState<{ preview: Preview; top: number; left: number; above: boolean } | null>(null);

  const show = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      const preview = await getPreview(slug);
      const el = anchor.current;
      if (!preview || !el) return;
      const r = el.getBoundingClientRect();
      const width = Math.min(320, window.innerWidth - 16);
      const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
      const above = r.bottom + 220 > window.innerHeight && r.top > 240;
      setCard({ preview, left, top: above ? r.top - 8 : r.bottom + 8, above });
    }, 350);
  };
  const hide = () => {
    window.clearTimeout(timer.current);
    setCard(null);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <>
      <Link
        ref={anchor}
        to={to}
        onMouseEnter={() => canHover() && show()}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={hide}
        aria-describedby={card ? `preview-${slug}` : undefined}
      >
        {children}
      </Link>
      {card &&
        createPortal(
          <div
            id={`preview-${slug}`}
            role="tooltip"
            className={card.above ? 'link-preview above' : 'link-preview'}
            style={{ left: card.left, top: card.top }}
          >
            {card.preview.hero_media_id && <MediaImage id={card.preview.hero_media_id} alt="" className="link-preview-art" />}
            <div className="link-preview-body">
              <span className="link-preview-type">{TEMPLATES[card.preview.type]?.glyph} {TEMPLATES[card.preview.type]?.label ?? card.preview.type}</span>
              <strong>{card.preview.title}</strong>
              {card.preview.subtitle && <em>{card.preview.subtitle}</em>}
              {card.preview.summary && <p>{plain(card.preview.summary).slice(0, 220)}{plain(card.preview.summary).length > 220 ? '…' : ''}</p>}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
