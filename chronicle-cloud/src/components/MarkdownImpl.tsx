import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { PreviewLink } from '../beta/PreviewLink.tsx';
import { expandWikiLinks } from '../lib/slug.ts';
import { MediaFigure, MediaImage } from './MediaImage.tsx';

interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
}

/** The pictures of a paragraph that holds nothing but Chronicle pictures (one = figure, several = gallery). */
function pictureParagraph(children: HastNode[] | undefined) {
  if (!children?.length) return null;
  const pics: { path: string; alt: string; caption: string }[] = [];
  for (const c of children) {
    if (c.type === 'text' && !c.value?.trim()) continue;
    if (c.type === 'element' && c.tagName === 'br') continue;
    const src = c.properties?.src;
    if (c.type !== 'element' || c.tagName !== 'img' || typeof src !== 'string' || !src.startsWith('media:')) return null;
    pics.push({ path: src.slice('media:'.length), alt: String(c.properties?.alt ?? ''), caption: String(c.properties?.title ?? '') });
  }
  return pics.length ? pics : null;
}

/**
 * Markdown without raw HTML (react-markdown escapes it). Internal [[links]] become router links;
 * images may only come from Chronicle's own private media (media:path), so article text cannot
 * pull in tracking pixels or images from elsewhere.
 */
export default function MarkdownImpl({ text }: { text: string }) {
  return (
    <div className="prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url) => (url.startsWith('media:') ? url : defaultUrlTransform(url))}
        components={{
          a({ href, children }) {
            if (href?.startsWith('/wiki/')) return <PreviewLink to={href} slug={decodeURIComponent(href.slice('/wiki/'.length).split(/[?#]/)[0]!)}>{children}</PreviewLink>;
            if (href && /^https?:\/\//.test(href)) {
              return (
                <a href={href} target="_blank" rel="noopener noreferrer nofollow">
                  {children}
                </a>
              );
            }
            return <span>{children}</span>;
          },
          p({ node, children }) {
            const pics = pictureParagraph(node?.children as HastNode[] | undefined);
            if (!pics) return <p>{children}</p>;
            if (pics.length === 1) return <MediaFigure {...pics[0]!} />;
            return (
              <div className="prose-gallery">
                {pics.map((pic, i) => <MediaFigure key={`${pic.path}-${i}`} {...pic} />)}
              </div>
            );
          },
          img({ src, alt }) {
            if (typeof src === 'string' && src.startsWith('media:')) {
              return <MediaImage path={src.slice('media:'.length)} alt={alt ?? ''} className="prose-image" />;
            }
            return <span className="muted">[image: {alt}]</span>;
          },
        }}
      >
        {expandWikiLinks(text)}
      </ReactMarkdown>
    </div>
  );
}
