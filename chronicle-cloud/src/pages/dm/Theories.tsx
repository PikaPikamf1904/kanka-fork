import { useMemo } from 'react';
import { loadBoard, resolvePins } from '../../lib/boardData.ts';
import { statusLabel } from '../../lib/boardLogic.ts';
import { useLoad } from '../../lib/useLoad.ts';
import { Link } from 'react-router';

/** Every theory card on the party's board, for the DM to read. Nothing here can be changed. */
export function Theories() {
  const data = useLoad(async () => {
    const board = await loadBoard();
    return { board, targets: await resolvePins(board.items) };
  }, []);
  const rows = useMemo(() => {
    if (!data.data) return [];
    const { board, targets } = data.data;
    const title = (id: string) => {
      const i = board.items.find((x) => x.id === id);
      return !i ? 'a removed card' : i.kind === 'pin' ? targets.get(i.ref_id ?? '')?.title ?? 'a pinned page that is no longer available' : i.title;
    };
    return board.items.filter((i) => i.kind === 'theory').map((t) => ({
      t,
      section: board.groups.find((g) => g.id === t.group_id)?.title ?? 'No section',
      connected: board.links.filter((l) => l.from_item === t.id || l.to_item === t.id).map((l) => ({ id: l.id, title: title(l.from_item === t.id ? l.to_item : l.from_item), label: l.label })),
    }));
  }, [data.data]);
  return (
    <div>
      <h1 className="page-title">Party theories</h1>
      <p className="muted">What the party is guessing, from their Investigation Board. These are speculation, not canon. This page is read-only; <Link to="/board">open the board</Link> to see them in place.</p>
      {data.loading && !data.data && <p className="muted" role="status">Reading the board…</p>}
      {data.error && <div className="notice" role="alert"><p>Could not load the board: {data.error}</p><button type="button" className="button secondary small" onClick={data.reload}>Try again</button></div>}
      {data.data && rows.length === 0 && <p className="panel">The party has not written any theories yet.</p>}
      {rows.map(({ t, section, connected }) => (
        <section key={t.id} className="panel" data-testid="theory-row" aria-label={`Theory: ${t.title}`}>
          <h2>{t.title}</h2>
          <p className="fine-print">By {t.author_name || 'someone'}{t.is_dm ? ' (DM)' : ''} · <span className="badge">{statusLabel(t.theory_status)}</span> · Section: {section}</p>
          {t.body && <p className="board-body">{t.body}</p>}
          {connected.length > 0 ? (
            <ul className="plain-list">{connected.map((c) => <li key={c.id}>Connected to <strong>{c.title}</strong>{c.label ? ` (${c.label})` : ''}</li>)}</ul>
          ) : <p className="muted">Not connected to anything.</p>}
        </section>
      ))}
    </div>
  );
}
