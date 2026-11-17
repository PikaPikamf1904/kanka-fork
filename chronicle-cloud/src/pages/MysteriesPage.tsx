import { useState } from 'react';
import { Link } from 'react-router';
import { ClueDialog } from '../components/Clues.tsx';
import { isReleased, kindLabel, mysteryShowsClues, sortClues } from '../lib/clues.ts';
import { attachNames, discoveredAmong, mysteryIndex, visibleClues, type ClueWithHints } from '../lib/mysteryData.ts';
import { useIsDm } from '../lib/session.tsx';
import { useLoad } from '../lib/useLoad.ts';

/** Mysteries the reader has run into. Only mysteries with at least one clue they can see appear, and nothing unreleased. */
export function MysteriesPage() {
  const isDm = useIsDm();
  const data = useLoad(async () => {
    const index = await mysteryIndex();
    const all = await visibleClues(index.map((m) => m.id));
    // The database returns only what a player may see; the DM's account reads everything, so apply the same rule here.
    const clues = isDm ? all.filter((c) => isReleased(c) && mysteryShowsClues(c.mystery_status)) : all;
    const [found, names] = await Promise.all([
      discoveredAmong(clues.map((c) => c.id)),
      attachNames(clues.flatMap((c) => (c.attach_article_id ? [c.attach_article_id] : [])), clues.flatMap((c) => (c.attach_map_id ? [c.attach_map_id] : []))),
    ]);
    const mysteries = index
      .map((m) => ({ ...m, list: sortClues(clues.filter((c) => c.mystery_id === m.id)) }))
      .filter((m) => m.list.length > 0);
    return { mysteries, found, names };
  }, [isDm]);
  const [open, setOpen] = useState<ClueWithHints | null>(null);
  const [foundNow, setFoundNow] = useState<string[]>([]);

  return (
    <div className="mysteries-page">
      <h1 className="page-title">Mysteries</h1>
      <p className="muted">The mysteries you have started to uncover. New clues turn up on pages and maps as the story goes on.</p>
      {data.loading && !data.data && <p className="muted" role="status">Looking through your finds…</p>}
      {data.error && <div className="notice" role="alert"><p>Could not load the mysteries: {data.error}</p><button type="button" className="button secondary small" onClick={data.reload}>Try again</button></div>}
      {data.data && data.data.mysteries.length === 0 && <p className="panel">Nothing to investigate yet. When the story gives you something to follow up, it will appear here.</p>}
      {data.data?.mysteries.map((m) => {
        const isFound = (id: string) => data.data!.found.has(id) || foundNow.includes(id);
        const n = m.list.filter((c) => isFound(c.id)).length;
        return (
          <section key={m.id} className={`panel mystery-card mystery-${m.colour}`} aria-labelledby={`m-${m.id}`}>
            <h2 id={`m-${m.id}`}>{m.title}</h2>
            <p className="muted" data-testid="mystery-count">{n} {n === 1 ? 'clue' : 'clues'} found of {m.list.length} seen</p>
            <ul className="plain-list">
              {m.list.map((c) => {
                const where = c.attach_article_id ? data.data!.names.get(c.attach_article_id) : c.attach_map_id ? data.data!.names.get(c.attach_map_id) : undefined;
                return (
                  <li key={c.id} data-testid="mystery-clue">
                    {isFound(c.id) ? (
                      <>
                        <button type="button" className="link-button" onClick={() => setOpen(c)}><strong>{c.title}</strong></button> <span className="badge">{kindLabel(c.kind)}</span>
                        {where && <> · found at <Link to={where.href}>{where.title}</Link></>}
                      </>
                    ) : where ? (
                      <>Not found yet. Have another look at <Link to={where.href}>{where.title}</Link>.</>
                    ) : (
                      <button type="button" className="clue-find" onClick={() => setOpen(c)}><span aria-hidden="true" className="clue-glyph">✦</span>Something catches your eye…</button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      {open && <ClueDialog clue={open} record={!isDm} onClose={() => setOpen(null)} onFound={() => setFoundNow((f) => [...f, open.id])} />}
    </div>
  );
}
