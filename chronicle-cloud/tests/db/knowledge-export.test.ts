// The DM's knowledge export, through the real API (PostgREST behind the local gateway) with real
// signed tokens for the DM, a player, a revoked player and an anonymous visitor. The export has no
// endpoint of its own: these tests prove that what it reads is decided by the database's own rules.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readLocalEnv } from '../../scripts/local-targets.mjs';
import { buildExport } from '../../src/lib/knowledgeExport/build.ts';
import { ExportRefused, loadExportData, TABLES_READ } from '../../src/lib/knowledgeExport/load.ts';
import { DEFAULT_OPTIONS } from '../../src/lib/knowledgeExport/types.ts';
import { admin, ids, resetFixtures } from './helpers.ts';

const env = readLocalEnv();
const secret = fs.readFileSync(path.resolve(import.meta.dirname, '../../.local/jwt_secret'), 'utf8').trim();

function token(sub?: string) {
  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const claims = sub
    ? { sub, role: 'authenticated', aud: 'authenticated', aal: 'aal1', is_anonymous: false, iat: now, exp: now + 600 }
    : { role: 'anon', iat: now, exp: now + 600 };
  const head = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(claims)}`;
  return `${head}.${crypto.createHmac('sha256', secret).update(head).digest('base64url')}`;
}
const client = (sub?: string): SupabaseClient => createClient(env.SUPABASE_URL!, env.SUPABASE_PUBLISHABLE_KEY!, {
  global: { headers: { Authorization: `Bearer ${token(sub)}` } },
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

// DM-only material in the fixtures (helpers.ts) and below. None may reach anyone but the DM.
const DM_ONLY = ['SPYMASTERWORD', 'SECRETWORD', 'DRAFTWORD', 'HIDDENARTICLEWORD', 'INFOBOXSECRET', 'NOTEWORD', 'Traitors', 'traitor-captain',
  'Secretly serves', 'MYSTERYWORD', 'CLUEWORD', 'DMRESEARCHWORD'];
// Never exported, not even to the DM.
const NEVER = ['JOURNALWORD', 'SCRATCHWORD', 'PLAYERRESEARCHWORD'];

const exportText = (data: Awaited<ReturnType<typeof loadExportData>>, dmSecrets = true) => {
  const b = buildExport(data, { ...DEFAULT_OPTIONS, dmSecrets, siteUrl: 'http://127.0.0.1:8788' });
  return [...b.archive.map((f) => f.path + f.text), ...b.notebook.map((d) => d.text)].join('\n');
};

async function fingerprint() {
  const tables = ['articles', 'article_sections', 'infobox_fields', 'relations', 'dm_notes', 'provenance', 'mysteries', 'clues', 'journal_entries', 'research_collections', 'campaign_members', 'revisions'];
  const out: Record<string, string> = {};
  for (const t of tables) out[t] = (await admin<{ f: string }>(`select count(*) || ':' || coalesce(md5(string_agg(t::text, '|' order by t::text)), '') as f from public.${t} t`)).rows[0]!.f;
  return out;
}

/** This file's own rows in tables the shared fixture reset does not clear (other specs count them). */
async function removeOwnRows() {
  await admin(`delete from public.clues where body = 'CLUEWORD body'`);
  await admin(`delete from public.mysteries where title = 'Synthetic mystery'`);
  await admin(`delete from public.journal_entries where body = 'JOURNALWORD private'`);
  await admin(`delete from public.scratchpad_notes where body = 'SCRATCHWORD private'`);
  await admin(`delete from public.research_notes where body in ('DMRESEARCHWORD idea', 'PLAYERRESEARCHWORD shared')`);
  await admin(`delete from public.research_collections where title in ('DM collection', 'Player collection') and user_id = any($1::uuid[])`, [[ids.dm, ids.player]]);
}

afterAll(removeOwnRows);

beforeAll(async () => {
  await removeOwnRows();
  await resetFixtures();
  await admin(`insert into public.provenance (article_id, section_id, kind) values ('a0000000-0000-4000-8000-00000000000a', '50000000-0000-4000-8000-000000000002', 'dm_confirmed')`);
  const m = await admin<{ id: string }>(`insert into public.mysteries (title, summary, dm_notes, status) values ('Synthetic mystery', 'A puzzle.', 'MYSTERYWORD notes', 'active') returning id`);
  await admin(`insert into public.clues (mystery_id, kind, title, body) values ($1, 'note', 'Hidden clue', 'CLUEWORD body')`, [m.rows[0]!.id]);
  await admin(`insert into public.journal_entries (user_id, title, body) values ($1, 'My diary', 'JOURNALWORD private')`, [ids.player]);
  await admin(`insert into public.scratchpad_notes (user_id, body) values ($1, 'SCRATCHWORD private')`, [ids.player]);
  const dmc = await admin<{ id: string }>(`insert into public.research_collections (user_id, title) values ($1, 'DM collection') returning id`, [ids.dm]);
  await admin(`insert into public.research_notes (collection_id, title, body) values ($1, 'Idea', 'DMRESEARCHWORD idea')`, [dmc.rows[0]!.id]);
  const pc = await admin<{ id: string }>(`insert into public.research_collections (user_id, title, shared) values ($1, 'Player collection', true) returning id`, [ids.player]);
  await admin(`insert into public.research_notes (collection_id, title, body) values ($1, 'Shared idea', 'PLAYERRESEARCHWORD shared')`, [pc.rows[0]!.id]);
});

describe('the DM', () => {
  it('exports everything the DM may read, and never journals, scratchpads or players’ research', async () => {
    const data = await loadExportData(client(ids.dm), { userId: ids.dm });
    const text = exportText(data);
    for (const s of DM_ONLY) expect(text, s).toContain(s);
    for (const s of NEVER) expect(text, s).not.toContain(s);
    expect(text).toContain('Secretly serves'); // a DM-only connection with its custom words
    expect(text).toContain('(a DM-approved secret)');
  });

  it('reads only the allowed tables', async () => {
    const data = await loadExportData(client(ids.dm), { userId: ids.dm });
    expect(data.tablesRead).toEqual([...TABLES_READ].sort());
    for (const t of ['journal_entries', 'journal_entry_links', 'scratchpad_notes', 'board_items', 'bookmarks', 'feedback', 'access_codes', 'member_devices']) {
      expect(data.tablesRead).not.toContain(t);
    }
  });

  it('reads every row, however small the pages', async () => {
    const a = await loadExportData(client(ids.dm), { userId: ids.dm });
    const b = await loadExportData(client(ids.dm), { userId: ids.dm, pageSize: 2 });
    expect({ ...b, generatedAt: '' }).toEqual({ ...a, generatedAt: '' });
    expect(a.articles.length).toBe(Number((await admin('select count(*) from public.articles')).rows[0]!.count));
    expect(a.relations.length).toBe(Number((await admin('select count(*) from public.relations')).rows[0]!.count));
  });

  it('changes nothing in the database', async () => {
    const before = await fingerprint();
    const data = await loadExportData(client(ids.dm), { userId: ids.dm });
    exportText(data);
    expect(await fingerprint()).toEqual(before);
  });

  it('a players-only export from the DM matches what a player can read', async () => {
    const text = exportText(await loadExportData(client(ids.dm), { userId: ids.dm }), false);
    for (const s of [...DM_ONLY, ...NEVER]) expect(text, s).not.toContain(s);
    expect(text).toContain('Lives in');
  });
});

describe('everyone else', () => {
  it('a player is refused', async () => {
    await expect(loadExportData(client(ids.player), { userId: ids.player })).rejects.toBeInstanceOf(ExportRefused);
  });

  it('a player claiming the DM’s id is refused too (players cannot read the DM’s membership)', async () => {
    await expect(loadExportData(client(ids.player), { userId: ids.dm })).rejects.toBeInstanceOf(ExportRefused);
  });

  it('a revoked player and an anonymous visitor are refused', async () => {
    await expect(loadExportData(client(ids.revoked), { userId: ids.revoked })).rejects.toBeInstanceOf(ExportRefused);
    await expect(loadExportData(client(), { userId: ids.dm })).rejects.toBeInstanceOf(ExportRefused);
  });

  it('reading the same tables directly through the API gives a player no DM-only material at all', async () => {
    const player = client(ids.player);
    const rows: Record<string, unknown> = {};
    for (const t of TABLES_READ) {
      const r = await player.from(t).select('*');
      rows[t] = r.error ? `error: ${r.error.code}` : r.data;
    }
    const json = JSON.stringify(rows);
    for (const s of DM_ONLY) expect(json, s).not.toContain(s);
    expect(rows.provenance).toEqual([]);
    expect(rows.dm_notes).toEqual([]);
    expect(rows.mysteries).toEqual([]);
  });

  it('an anonymous visitor reads nothing', async () => {
    const anon = client();
    for (const t of ['articles', 'article_sections', 'relations', 'dm_notes', 'provenance'] as const) {
      const r = await anon.from(t).select('*');
      expect(r.error ? [] : r.data, t).toEqual([]);
    }
  });
});
