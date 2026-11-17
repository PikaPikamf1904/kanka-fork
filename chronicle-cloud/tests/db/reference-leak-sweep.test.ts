// Every foreign-key column a signed-in user may select is checked: a row a member can read must not
// point at a row they cannot read (the shape of the current-location leak fixed in 20261116000100).
// The probe is generated from the catalogue, so a new table or column is covered without editing
// this file. Fixtures are synthetic.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, as, ids, pool, resetFixtures } from './helpers.ts';

const SECRET = 'a0000000-0000-4000-8000-00000000000b';
// References that are allowed to point at something the reader cannot see, and why.
const ALLOWED: Record<string, string> = {
  // A member's own row names the access code they enrolled with; the code itself stays DM-only.
  'campaign_members.enrolled_via': 'own enrollment',
  // Reader notes (20261117000100): a person's own bookmark, scratchpad note or journal link to a page that
  // was readable when they made it and has been hidden since. The row holds only the page id they once
  // saw; no title or address is stored, the page itself no longer comes back, and a hidden page's id is
  // refused on every insert and update, so these tables cannot be used to probe for hidden pages.
  'bookmarks.article_id': 'own bookmark: only the id of a page the owner could once read',
  'scratchpad_notes.article_id': 'own scratchpad note: only the id of a page the owner could once read',
  'journal_entry_links.article_id': 'own journal link: only the id of a page the owner could once read',
};

let probes: { fk: string; sql: string }[] = [];

beforeAll(async () => {
  await resetFixtures();
  // Point every settable reference we can at a DM-only page, so a leak has something to show.
  await admin(`update public.campaign_settings set current_location_id = $1`, [SECRET]);
  // Own rows of the reader-notes tables pointing at the hidden page (as if it was hidden after saving).
  await admin(`insert into public.bookmarks (user_id, article_id) values ($1, $2)`, [ids.player, SECRET]);
  await admin(`insert into public.scratchpad_notes (user_id, article_id, body) values ($1, $2, 'Zz sweep')`, [ids.player, SECRET]);
  const entry = await admin<{ id: string }>(`insert into public.journal_entries (user_id, title) values ($1, 'Zz sweep') returning id`, [ids.player]);
  await admin(`insert into public.journal_entry_links (entry_id, article_id) values ($1, $2)`, [entry.rows[0]!.id, SECRET]);
  probes = (
    await admin<{ fk: string; sql: string }>(`
      select c.conrelid::regclass::text || '.' || a.attname as fk,
             format('select count(*)::int as n from public.%I t where t.%I is not null and not exists (select 1 from public.%I r where r.%I = t.%I)',
                    cl.relname, a.attname, rc.relname, ra.attname, a.attname) as sql
      from pg_constraint c
      join pg_class cl on cl.oid = c.conrelid join pg_namespace n on n.oid = cl.relnamespace
      join pg_class rc on rc.oid = c.confrelid join pg_namespace rn on rn.oid = rc.relnamespace
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      join pg_attribute ra on ra.attrelid = c.confrelid and ra.attnum = c.confkey[1]
      where c.contype = 'f' and n.nspname = 'public' and rn.nspname = 'public' and cardinality(c.conkey) = 1
        and has_column_privilege('authenticated', c.conrelid, a.attname, 'select')
      order by 1`)
  ).rows;
});
afterAll(async () => {
  await admin(`update public.campaign_settings set current_location_id = null`);
  await admin(`delete from public.bookmarks`);
  await admin(`delete from public.scratchpad_notes`);
  await admin(`delete from public.journal_entries`);
  await pool.end();
});

describe('references to hidden rows', () => {
  it('covers the readable foreign keys, and not the location id any more', () => {
    expect(probes.length).toBeGreaterThan(15);
    expect(probes.map((p) => p.fk)).not.toContain('campaign_settings.current_location_id');
  });

  for (const who of ['player', 'revoked', 'outsider'] as const) {
    it(`${who}: no readable row points at a row they cannot read`, async () => {
      const leaks: string[] = [];
      for (const p of probes) {
        const r = await as<{ n: number }>(who, p.sql);
        if (r.error) {
          // A table the caller may not read at all cannot leak through its columns.
          expect(r.error.code, p.fk).toBe('42501');
          continue;
        }
        if (r.rows[0]!.n > 0 && !ALLOWED[p.fk]) leaks.push(`${p.fk} (${r.rows[0]!.n})`);
      }
      expect(leaks).toEqual([]);
    });
  }
});
