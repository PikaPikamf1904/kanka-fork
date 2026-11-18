import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router';
import { StatusBadge, VisibilityBadge } from '../../components/Badges.tsx';
import { loadVisibilityAuditData } from '../../lib/api.ts';
import { TEMPLATES, TYPE_ORDER } from '../../lib/templates.ts';
import type { ArticleType } from '../../lib/types.ts';
import { useLoad } from '../../lib/useLoad.ts';
import { computeAudit, type Finding, type FindingKind, type Totals } from '../../lib/visibilityAudit.ts';

const FINDINGS: { kind: FindingKind; title: string; hint: string }[] = [
  { kind: 'link', title: 'Links to hidden pages', hint: 'Text players can read links to a page they cannot. The link itself shows them the hidden page’s name.' },
  { kind: 'mention', title: 'Hidden names in visible text', hint: 'Text players can read contains the exact name of a page they cannot (whole words, at least five letters). It may be fine, or it may give something away.' },
  { kind: 'media', title: 'Hidden pictures in visible text', hint: 'Text players can read places a picture that is DM-only. Players see no picture, but its file name arrives with the text.' },
  { kind: 'category', title: 'Visible categories of hidden pages', hint: 'Players can see this category’s name, but every page in it is hidden from them. The name alone may give something away.' },
  { kind: 'empty', title: 'Published pages that show players nothing', hint: 'Players can open these pages, but every section is DM-only or a draft and there is no summary.' },
  { kind: 'draft', title: 'Meant for players, still drafts', hint: 'Set to “players” but not published, so players cannot see them yet.' },
];

function Bar({ t, label }: { t: Totals; label: string }) {
  const total = t.readable + t.playersDraft + t.dmOnly;
  const pct = (n: number) => (total ? `${(n / total) * 100}%` : '0%');
  return (
    <div className="vis-row">
      <span className="vis-label">{label}</span>
      <span className="vis-bar" aria-hidden="true">
        <span className="vis-seg vis-readable" style={{ width: pct(t.readable) }} />
        <span className="vis-seg vis-draft" style={{ width: pct(t.playersDraft) }} />
        <span className="vis-seg vis-dm" style={{ width: pct(t.dmOnly) }} />
      </span>
      <span className="vis-numbers">{t.readable} players can read · {t.playersDraft} players, draft · {t.dmOnly} DM only</span>
    </div>
  );
}

function Row({ f }: { f: Finding }) {
  return (
    <li>
      <span className="tidy-main">
        <Link to={`/wiki/${f.page.slug}`}>{f.page.title}</Link>
        {f.where && <span className="muted">&nbsp;· {f.where}</span>}
        {f.hidden && (
          <>
            &nbsp;→&nbsp;<Link to={`/wiki/${f.hidden.slug}`}>{f.hidden.title}</Link>
          </>
        )}
        {f.kind === 'media' && <>&nbsp;→&nbsp;<code>{f.detail}</code></>}
        {f.kind === 'category' && <>&nbsp;· category “{f.detail}”</>}
      </span>
      <span className="badges-row">
        {f.hidden ? <VisibilityBadge visibility={f.hidden.visibility} /> : <VisibilityBadge visibility={f.page.visibility} />}
        <StatusBadge status={(f.hidden ?? f.page).status} />
      </span>
      <Link className="button secondary small" to={`/dm/edit/${f.page.slug}`} aria-label={`Edit ${f.page.title}`}>Edit</Link>
      {f.hidden && <Link className="button secondary small" to={`/dm/edit/${f.hidden.slug}`} aria-label={`Edit ${f.hidden.title}`}>Edit hidden page</Link>}
    </li>
  );
}

export function VisibilityAudit() {
  const data = useLoad(loadVisibilityAuditData, []);
  const [params, setParams] = useSearchParams();
  const asked = params.get('type');
  const type = (TYPE_ORDER as string[]).includes(asked ?? '') ? (asked as ArticleType) : null;
  const audit = useMemo(() => (data.data ? computeAudit(data.data) : null), [data.data]);
  const keep = (f: Finding) => !type || f.page.type === type || f.hidden?.type === type;

  return (
    <div>
      <h1 className="page-title">What players can see</h1>
      <p className="muted">
        A read-only overview. Nothing here changes visibility: use the edit links. News stories are not counted. See also{' '}
        <Link to="/dm/tidy">Tidy up the wiki</Link>.
      </p>
      <label className="tidy-type">
        <span>Kind of page</span>
        <select value={type ?? ''} onChange={(e) => {
          const next = new URLSearchParams(params);
          if (e.target.value) next.set('type', e.target.value);
          else next.delete('type');
          setParams(next, { replace: true });
        }}>
          <option value="">All kinds</option>
          {TYPE_ORDER.map((t) => <option key={t} value={t}>{TEMPLATES[t].plural}</option>)}
        </select>
      </label>
      {data.loading && <p className="muted" role="status">Checking every page…</p>}
      {data.error && (
        <div className="notice" role="alert">
          <p>Could not check the wiki: {data.error}</p>
          <button type="button" className="button secondary small" onClick={data.reload}>Try again</button>
        </div>
      )}
      {audit && (
        <>
          <nav className="tidy-summary" aria-label="Possible problems" data-testid="vis-strip">
            {FINDINGS.map((o) => {
              const n = audit.findings[o.kind].filter(keep).length;
              return (
                <a key={o.kind} href={`#vis-${o.kind}`} className={n > 0 ? 'tidy-summary-link' : 'tidy-summary-link tidy-summary-zero'}
                  onClick={() => {
                    const el = document.getElementById(`vis-${o.kind}`);
                    if (el instanceof HTMLDetailsElement) el.open = true;
                  }}>
                  <span className="tidy-summary-count">{n}</span>
                  <span>{o.title}</span>
                </a>
              );
            })}
          </nav>
          {FINDINGS.map((o) => {
            const rows = audit.findings[o.kind].filter(keep);
            return (
              <details key={o.kind} className="panel tidy-section" id={`vis-${o.kind}`} data-testid={`vis-${o.kind}`}>
                <summary>
                  <span className="tidy-title">{o.title}</span>
                  <span className="badge badge-ok tidy-count" aria-label={`${rows.length} found`}>{rows.length}</span>
                </summary>
                <p className="fine-print">{o.hint}</p>
                {rows.length === 0 ? <p className="muted">Nothing found.</p> : (
                  <ul className="tidy-list">{rows.map((f) => <Row key={`${f.page.id}|${f.where}|${f.hidden?.id ?? ''}`} f={f} />)}</ul>
                )}
              </details>
            );
          })}
          <section className="panel" aria-labelledby="vis-totals">
            <h2 id="vis-totals">Pages by who can read them</h2>
            <p className="vis-legend fine-print">
              <span className="vis-key vis-readable" aria-hidden="true" /> players can read
              <span className="vis-key vis-draft" aria-hidden="true" /> set to players, still a draft
              <span className="vis-key vis-dm" aria-hidden="true" /> DM only
            </p>
            <Bar t={audit.overall} label="All pages" />
            {audit.byType.filter((r) => !type || r.type === type).map((r) => <Bar key={r.type} t={r.totals} label={TEMPLATES[r.type].plural} />)}
            {!type && audit.byCategory.length > 0 && (
              <>
                <h3>By category</h3>
                {audit.byCategory.map((c) => <Bar key={c.id} t={c.totals} label={c.name} />)}
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
