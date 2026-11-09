import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Link } from 'react-router';
import { expandWikiLinks } from '../lib/slug.ts';
import { MediaImage } from './MediaImage.tsx';

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
            if (href?.startsWith('/wiki/')) return <Link to={href}>{children}</Link>;
            if (href && /^https?:\/\//.test(href)) {
              return (
                <a href={href} target="_blank" rel="noopener noreferrer nofollow">
                  {children}
                </a>
              );
            }
            return <span>{children}</span>;
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
