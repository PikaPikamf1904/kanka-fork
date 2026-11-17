import { Link } from 'react-router';
import type { Crumb } from '../lib/breadcrumbs.ts';

export function Breadcrumbs({ trail }: { trail: Crumb[] }) {
  return (
    <nav className="breadcrumbs article-breadcrumbs" aria-label="Breadcrumbs">
      <ol>
        {trail.map((c, i) => (
          <li key={i}>
            {c.to && i < trail.length - 1 ? <Link to={c.to}>{c.label}</Link> : <span aria-current="page">{c.label}</span>}
            {i < trail.length - 1 && <span aria-hidden="true"> › </span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}
