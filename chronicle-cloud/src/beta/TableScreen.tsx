import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { MediaImage } from '../components/MediaImage.tsx';
import { useSession } from '../lib/session.tsx';
import { TEMPLATES } from '../lib/templates.ts';
import type { ArticleRef } from '../lib/types.ts';
import { getPreview, pageIndex, type Preview } from './api.ts';
import { d20, describe, roll, type RollResult } from './dice.ts';
import { rank } from './fuzzy.ts';
import * as I from './initiative.ts';
import { keyFor, load, save } from './store.ts';
import './beta.css';

/** The DM's screen for running a session. Everything here stays on this device; nothing is saved to Chronicle. */
export function TableScreen() {
  const { state } = useSession();
  const userId = state.kind === 'member' ? state.userId : 'anon';
  return (
    <div className="table-screen">
      <h1 className="page-title">Table screen <span className="beta-tag">beta</span></h1>
      <p className="fine-print">For running a session: initiative, dice, the pages you need at hand and quick notes. All of it is kept on this device only and never sent to Chronicle or shown to players.</p>
      <div className="table-grid">
        <Initiative storeKey={keyFor('initiative', userId)} />
        <Dice storeKey={keyFor('dice', userId)} />
        <Pins storeKey={keyFor('pins', userId)} />
        <Notes storeKey={keyFor('notes', userId)} />
      </div>
    </div>
  );
}

function usePersistent<T>(key: string, fallback: T, parse?: (raw: unknown) => T) {
  const [value, setValue] = useState<T>(() => load(key, fallback, parse));
  useEffect(() => save(key, value), [key, value]);
  return [value, setValue] as const;
}

const newId = () => crypto.randomUUID();

function Initiative({ storeKey }: { storeKey: string }) {
  const [enc, setEnc] = usePersistent<I.Encounter>(storeKey, I.EMPTY, I.parseSaved);
  const [form, setForm] = useState({ name: '', init: '', hp: '', player: false });
  const list = I.ordered(enc.combatants);
  const current = list[enc.active];

  function addOne(e: FormEvent) {
    e.preventDefault();
    const name = form.name.trim();
    if (!name) return;
    const init = form.init.trim() ? Number(form.init) : roll('d20').total;
    const hp = form.hp.trim() ? Math.max(0, Number(form.hp) || 0) : null;
    setEnc((x) => I.add(x, { id: newId(), name: name.slice(0, 80), init: Number.isFinite(init) ? init : 0, hp, maxHp: hp, note: '', player: form.player }));
    setForm({ name: '', init: '', hp: '', player: form.player });
  }

  return (
    <section className="panel table-panel" aria-labelledby="init-title">
      <div className="table-head">
        <h2 id="init-title">Initiative</h2>
        <span className="table-round" aria-live="polite">Round {enc.round}{current ? ` · ${current.name}’s turn` : ''}</span>
      </div>
      <form className="init-form" onSubmit={addOne}>
        <input aria-label="Name" placeholder="Name" value={form.name} maxLength={80} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input aria-label="Initiative" placeholder="Init (blank = d20)" inputMode="numeric" value={form.init} onChange={(e) => setForm({ ...form, init: e.target.value.replace(/[^\d-]/g, '') })} />
        <input aria-label="Hit points" placeholder="HP" inputMode="numeric" value={form.hp} onChange={(e) => setForm({ ...form, hp: e.target.value.replace(/\D/g, '') })} />
        <label className="checkbox"><input type="checkbox" checked={form.player} onChange={(e) => setForm({ ...form, player: e.target.checked })} /> Player</label>
        <button type="submit" className="button small">Add</button>
      </form>
      {list.length === 0 ? (
        <p className="muted">Add the party and the monsters. Leave initiative blank to roll a d20.</p>
      ) : (
        <ol className="init-list">
          {list.map((c, i) => (
            <li key={c.id} className={`${i === enc.active ? 'on' : ''} ${c.player ? 'player' : ''} ${c.hp === 0 ? 'down' : ''}`.trim()} aria-current={i === enc.active ? 'true' : undefined}>
              <input className="init-value" aria-label={`${c.name} initiative`} inputMode="numeric" value={c.init} onChange={(e) => setEnc((x) => I.update(x, c.id, { init: Number(e.target.value.replace(/[^\d-]/g, '')) || 0 }))} />
              <span className="init-name">{c.name}</span>
              {c.hp !== null && (
                <span className="init-hp">
                  <button type="button" className="icon-button" aria-label={`${c.name} loses 1 hit point`} onClick={() => setEnc((x) => I.changeHp(x, c.id, -1))}>−</button>
                  <span aria-label={`${c.name} hit points`}>{c.hp}{c.maxHp !== null ? `/${c.maxHp}` : ''}</span>
                  <button type="button" className="icon-button" aria-label={`${c.name} gains 1 hit point`} onClick={() => setEnc((x) => I.changeHp(x, c.id, 1))}>+</button>
                  <HpAdjust name={c.name} onApply={(d) => setEnc((x) => I.changeHp(x, c.id, d))} />
                </span>
              )}
              <input className="init-note" aria-label={`${c.name} conditions`} placeholder="Conditions" value={c.note} maxLength={200} onChange={(e) => setEnc((x) => I.update(x, c.id, { note: e.target.value }))} />
              <button type="button" className="icon-button" aria-label={`Remove ${c.name}`} onClick={() => setEnc((x) => I.remove(x, c.id))}>✕</button>
            </li>
          ))}
        </ol>
      )}
      <div className="row-wrap">
        <button type="button" className="button secondary small" disabled={!list.length} onClick={() => setEnc(I.previous)}>Previous</button>
        <button type="button" className="button small" disabled={!list.length} onClick={() => setEnc(I.next)}>Next turn</button>
        <button type="button" className="button secondary small" disabled={!list.length} onClick={() => setEnc((x) => ({ ...x, active: 0, round: 1 }))}>Restart</button>
        <button
          type="button"
          className="button secondary small"
          disabled={!list.length}
          onClick={() => window.confirm('Clear the initiative list?') && setEnc((x) => ({ ...I.EMPTY, combatants: x.combatants.filter((c) => c.player) }))}
        >
          Clear monsters
        </button>
      </div>
    </section>
  );
}

function HpAdjust({ name, onApply }: { name: string; onApply(delta: number): void }) {
  const [v, setV] = useState('');
  const apply = (sign: 1 | -1) => {
    const n = Number(v);
    if (n > 0) onApply(sign * n);
    setV('');
  };
  return (
    <span className="hp-adjust">
      <input aria-label={`Amount for ${name}`} inputMode="numeric" placeholder="±" value={v} onChange={(e) => setV(e.target.value.replace(/\D/g, ''))} />
      <button type="button" className="chip" onClick={() => apply(-1)} aria-label={`Damage ${name}`}>Hit</button>
      <button type="button" className="chip" onClick={() => apply(1)} aria-label={`Heal ${name}`}>Heal</button>
    </span>
  );
}

function Dice({ storeKey }: { storeKey: string }) {
  const [history, setHistory] = usePersistent<{ at: string; label: string; total: number; detail: string }[]>(storeKey, [], (r) => (Array.isArray(r) ? r.slice(0, 20) : []));
  const [expr, setExpr] = useState('');
  const [mod, setMod] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const last = history[0];

  function doRoll(expression: string, label = expression) {
    setError(null);
    try {
      const r: RollResult = roll(expression);
      setHistory((h) => [{ at: new Date().toISOString(), label, total: r.total, detail: describe(r) }, ...h].slice(0, 20));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not roll that.');
    }
  }

  return (
    <section className="panel table-panel" aria-labelledby="dice-title">
      <h2 id="dice-title">Dice</h2>
      <div className="dice-result" aria-live="polite">
        {last ? (<><span className="dice-total">{last.total}</span><span className="dice-detail">{last.label} · {last.detail}</span></>) : <span className="muted">Roll something.</span>}
      </div>
      <div className="dice-buttons">
        {[4, 6, 8, 10, 12, 20, 100].map((s) => (
          <button key={s} type="button" className="chip" onClick={() => doRoll(`d${s}`)}>d{s}</button>
        ))}
      </div>
      <div className="dice-d20 row-wrap">
        <label>Modifier <input type="number" value={mod} min={-20} max={20} onChange={(e) => setMod(Math.max(-20, Math.min(20, Number(e.target.value) || 0)))} /></label>
        <button type="button" className="button small" onClick={() => doRoll(d20('normal', mod), 'Check')}>d20</button>
        <button type="button" className="button secondary small" onClick={() => doRoll(d20('advantage', mod), 'Advantage')}>Advantage</button>
        <button type="button" className="button secondary small" onClick={() => doRoll(d20('disadvantage', mod), 'Disadvantage')}>Disadvantage</button>
      </div>
      <form className="row-wrap" onSubmit={(e) => { e.preventDefault(); if (expr.trim()) doRoll(expr.trim()); }}>
        <input aria-label="Dice expression" placeholder="e.g. 8d6, 4d6kh3, 2d8+3" value={expr} onChange={(e) => setExpr(e.target.value)} />
        <button type="submit" className="button small">Roll</button>
      </form>
      {error && <p className="form-error" role="alert">{error}</p>}
      {history.length > 1 && (
        <ol className="dice-history" aria-label="Earlier rolls">
          {history.slice(1, 8).map((h) => <li key={h.at}><strong>{h.total}</strong> <span className="muted">{h.label} · {h.detail}</span></li>)}
        </ol>
      )}
    </section>
  );
}

function Pins({ storeKey }: { storeKey: string }) {
  const [pins, setPins] = usePersistent<string[]>(storeKey, [], (r) => (Array.isArray(r) ? r.filter((x): x is string => typeof x === 'string').slice(0, 24) : []));
  const [q, setQ] = useState('');
  const [index, setIndex] = useState<ArticleRef[]>([]);
  const [cards, setCards] = useState<Map<string, Preview | null>>(new Map());
  useEffect(() => {
    let live = true;
    pageIndex().then((p) => live && setIndex(p), () => undefined);
    return () => { live = false; };
  }, []);
  useEffect(() => {
    let live = true;
    Promise.all(pins.map(async (slug) => [slug, await getPreview(slug)] as const)).then((rows) => live && setCards(new Map(rows)));
    return () => { live = false; };
  }, [pins]);
  const found = q.trim() ? rank(q, index.filter((p) => !pins.includes(p.slug)), (p) => p.title, 6) : [];
  return (
    <section className="panel table-panel" aria-labelledby="pins-title">
      <h2 id="pins-title">Pinned pages</h2>
      <input type="search" aria-label="Find a page to pin" placeholder="Find a page to pin…" value={q} onChange={(e) => setQ(e.target.value)} />
      {found.length > 0 && (
        <ul className="pin-found">
          {found.map((p) => (
            <li key={p.slug}>
              <button type="button" className="link-button" onClick={() => { setPins((x) => [...x, p.slug]); setQ(''); }}>
                <span aria-hidden="true">{TEMPLATES[p.type]?.glyph} </span>Pin {p.title}
              </button>
            </li>
          ))}
        </ul>
      )}
      {pins.length === 0 ? (
        <p className="muted">Pin the NPCs, places and handouts you need tonight.</p>
      ) : (
        <ul className="pin-list">
          {pins.map((slug) => {
            const c = cards.get(slug);
            return (
              <li key={slug} className="pin-card">
                {c?.hero_media_id && <MediaImage id={c.hero_media_id} alt="" className="pin-art" />}
                <div className="pin-body">
                  <span className="link-preview-type">{c ? `${TEMPLATES[c.type]?.glyph ?? ''} ${TEMPLATES[c.type]?.label ?? c.type}` : ''}</span>
                  <Link to={c?.type === 'news' ? `/news/${slug}` : `/wiki/${slug}`} target="_blank" rel="noopener">{c?.title ?? slug}</Link>
                  {c?.subtitle && <em>{c.subtitle}</em>}
                  {c === null && <span className="muted">No longer available.</span>}
                </div>
                <button type="button" className="icon-button" aria-label={`Unpin ${c?.title ?? slug}`} onClick={() => setPins((x) => x.filter((s) => s !== slug))}>✕</button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Notes({ storeKey }: { storeKey: string }) {
  const [text, setText] = usePersistent<string>(storeKey, '', (r) => (typeof r === 'string' ? r.slice(0, 20_000) : ''));
  return (
    <section className="panel table-panel" aria-labelledby="notes-title">
      <h2 id="notes-title">Table notes</h2>
      <textarea aria-label="Table notes" rows={8} maxLength={20_000} value={text} onChange={(e) => setText(e.target.value)} placeholder="Names you made up, loot handed out, who owes whom…" />
      <p className="fine-print">Kept on this device only. Copy anything worth keeping into a page or a private note after the session.</p>
    </section>
  );
}
