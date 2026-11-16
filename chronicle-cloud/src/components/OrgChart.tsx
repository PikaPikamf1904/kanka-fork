import { Link } from 'react-router';
import { loadOrg } from '../lib/api.ts';
import { buildOrg, orgSize, type OrgRef, type OrgUnit } from '../lib/orgChart.ts';
import { useLoad } from '../lib/useLoad.ts';

/** Who belongs to a faction, by rank, with its sub-factions; from "Member of" connections only. */
export function OrgChart({ faction }: { faction: OrgRef }) {
  const data = useLoad(() => loadOrg(faction.id), [faction.id]);
  if (data.loading || data.error || !data.data) return null;
  const unit = buildOrg(faction, data.data);
  if (orgSize(unit) === 0) return null;
  return (
    <section className="article-section" aria-labelledby="org-chart">
      <h2 id="org-chart">Organisation</h2>
      <div className="org-chart" data-testid="org-chart">
        <Unit unit={unit} root />
      </div>
    </section>
  );
}

function Unit({ unit, root = false }: { unit: OrgUnit; root?: boolean }) {
  return (
    <div className={root ? 'org-unit org-root' : 'org-unit'}>
      <div className="org-faction">{root ? unit.faction.title : <Link to={`/wiki/${unit.faction.slug}`}>{unit.faction.title}</Link>}</div>
      {unit.groups.length > 0 && (
        <ul className="org-groups">
          {unit.groups.map((g) => (
            <li key={g.rank} className="org-group">
              <span className="org-rank">{g.rank}</span>
              <ul className="org-members" aria-label={`${g.rank} of ${unit.faction.title}`}>
                {g.members.map((m) => <li key={m.id}><Link className="chip" to={`/wiki/${m.slug}`}>{m.title}</Link></li>)}
              </ul>
            </li>
          ))}
        </ul>
      )}
      {unit.subFactions.length > 0 && (
        <ul className="org-subs" aria-label={`Groups within ${unit.faction.title}`}>
          {unit.subFactions.map((s) => <li key={s.faction.id}><Unit unit={s} /></li>)}
        </ul>
      )}
    </div>
  );
}
