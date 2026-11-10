import { slugify } from '../lib/slug.ts';

export function sectionAnchor(heading: string, index: number): string {
  return `s-${slugify(heading) || index + 1}`;
}

export function Toc({ headings }: { headings: string[] }) {
  const items = headings.map((h, i) => ({ h, i })).filter(({ h }) => h.trim());
  if (items.length < 2) return null;
  return (
    <nav className="toc" aria-label="Contents">
      <div className="toc-title">Contents</div>
      <ol>
        {items.map(({ h, i }) => (
          <li key={i}>
            <a href={`#${sectionAnchor(h, i)}`}>{h}</a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
