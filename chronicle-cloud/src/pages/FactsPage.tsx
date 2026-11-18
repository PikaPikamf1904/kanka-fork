import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router';
import { loadFacts } from '../lib/api.ts';
import { factsHref, valueCounts } from '../lib/facts.ts';
import { TEMPLATES } from '../lib/templates.ts';
import { useLoad } from '../lib/useLoad.ts';

/** Every page that shares one infobox value, e.g. /facts?label=Race&value=Elf. */
export function FactsPage() {
  const [params] = useSearchParams();
  const label = (params.get('label') ?? '').slice(0, 80);
  const value = (params.get('value') ?? '').slice(0, 80);
  const data = useLoad(() => (label && value ? loadFacts(label, value) : Promise.resolve(null)), [label, value]);
  const others = useMemo(() => valueCounts(data.data?.values ?? []).filter((v) => v.value.toLowerCase() !== value.toLowerCase()), [data.data, value]);

  if (!label || !value) return <p className="muted">Choose a value from a page’s fact box to see every page that shares it.</p>;
  return (
    <div className="facts-page">
      <h1 className="page-title">{label}: {value}</h1>
      {data.loading && <p className="muted" role="status">Looking…</p>}
      {data.error && <p className="form-error" role="alert">Could not look this up: {data.error}</p>}
      {data.data && (
        <>
          <p className="muted">{data.data.pages.length === 1 ? 'Only one page so far.' : `${data.data.pages.length} pages.`}</p>
          {data.data.pages.length > 0 && (
            <ul className="facts-list">
              {data.data.pages.map((p) => (
                <li key={p.id}>
                  <Link to={`/wiki/${p.slug}`}>{p.title}</Link>
                  <span className="badge">{TEMPLATES[p.type].label}</span>
                  {p.summary && <span className="muted facts-summary">{p.summary.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2').replace(/\[\[([^\]]+)\]\]/g, '$1').slice(0, 140)}</span>}
                </li>
              ))}
            </ul>
          )}
          {others.length > 0 && (
            <section aria-labelledby="facts-others">
              <h2 id="facts-others">Other values of “{label}”</h2>
              <p className="chip-cloud">
                {others.slice(0, 40).map((o) => (
                  <Link key={o.value} className="chip" to={factsHref(label, o.value)}>{o.value} <span className="muted">({o.count})</span></Link>
                ))}
              </p>
            </section>
          )}
        </>
      )}
    </div>
  );
}
