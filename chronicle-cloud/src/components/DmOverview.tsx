import { Link } from 'react-router';
import { supabase } from '../lib/supabase.ts';
import { useLoad } from '../lib/useLoad.ts';

interface Overview {
  newFeedback: number | null;
  newComfort: number | null;
  openTheories: number | null;
  journalWeek: number | null;
  waitingLinks: number | null;
}

/** Counts only; each is null when its feature is not installed. Feedback text never appears here. */
async function loadOverview(): Promise<Overview> {
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const count = async (q: PromiseLike<{ count: number | null; error: unknown }>) => {
    const r = await q;
    return r.error ? null : (r.count ?? 0);
  };
  const [newFeedback, newComfort, openTheories, journalWeek, waitingLinks] = await Promise.all([
    count(supabase.from('feedback').select('id', { count: 'exact', head: true }).eq('status', 'new')),
    count(supabase.from('feedback').select('id', { count: 'exact', head: true }).eq('status', 'new').eq('category', 'comfort')),
    count(supabase.from('board_items').select('id', { count: 'exact', head: true }).eq('kind', 'theory').eq('theory_status', 'unresolved')),
    count(supabase.from('journal_entries').select('id', { count: 'exact', head: true }).gte('entry_date', weekAgo)),
    count(supabase.from('player_invitations').select('id', { count: 'exact', head: true }).is('used_at', null).is('revoked_at', null).gt('expires_at', new Date().toISOString())),
  ]);
  return { newFeedback, newComfort, openTheories, journalWeek, waitingLinks };
}

/** DM desk: the players' side of the campaign at a glance. */
export function DmOverview() {
  const o = useLoad(loadOverview, []);
  if (!o.data) return null;
  const items: { n: number | null; label: string; to: string; urgent?: boolean }[] = [
    { n: o.data.newComfort, label: 'new boundaries or discomfort reports', to: '/dm/feedback', urgent: true },
    { n: o.data.newFeedback, label: 'new feedback', to: '/dm/feedback' },
    { n: o.data.openTheories, label: 'open party theories', to: '/dm/theories' },
    { n: o.data.journalWeek, label: 'journal entries this week', to: '/dm/insights' },
    { n: o.data.waitingLinks, label: 'invitation links not used yet', to: '/dm/access' },
  ];
  const shown = items.filter((i) => i.n !== null);
  if (shown.length === 0) return null;
  return (
    <section className="panel dm-overview" aria-labelledby="dm-overview">
      <h2 id="dm-overview">Players at a glance</h2>
      <ul className="tidy-summary">
        {shown.map((i) => (
          <li key={i.label}>
            <Link to={i.to} className={i.urgent && i.n ? 'tidy-summary-link dm-overview-urgent' : i.n ? 'tidy-summary-link' : 'tidy-summary-link tidy-summary-zero'}>
              <span className="tidy-summary-count">{i.n}</span>
              <span>{i.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
