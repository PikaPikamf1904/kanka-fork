// The Knowledge Graph's link query, exactly as the website sends it, through the LOCAL PostgREST and
// Row Level Security: each link carries its section's page id, and a player never receives a link
// that sits in a section they cannot read.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { admin, ids, pool, resetFixtures } from './helpers.ts';

const local = path.resolve(import.meta.dirname, '../../.local');
const kv = Object.fromEntries(fs.readFileSync(path.join(local, 'env'), 'utf8').split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const SECRET = fs.readFileSync(path.join(local, 'jwt_secret'), 'utf8').trim();

function token(who: keyof typeof ids) {
  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({ sub: ids[who], role: 'authenticated', aud: 'authenticated', aal: 'aal1', iat: now, exp: now + 600 });
  return `${head}.${body}.${crypto.createHmac('sha256', SECRET).update(`${head}.${body}`).digest('base64url')}`;
}

/** The same request loadGraphData() makes (optionally with the "view as a player" filters). */
async function links(who: keyof typeof ids, readerView = false) {
  const q = new URLSearchParams({ select: 'target_slug,section:article_sections!inner(article_id)', order: 'source_section_id,target_slug' });
  if (readerView) {
    q.set('section.visibility', 'eq.players');
    q.set('section.status', 'eq.published');
  }
  const res = await fetch(`${kv.SUPABASE_URL}/rest/v1/article_links?${q}`, {
    headers: { apikey: kv.SUPABASE_PUBLISHABLE_KEY!, authorization: `Bearer ${token(who)}` },
  });
  expect(res.status).toBe(200);
  const rows = (await res.json()) as { target_slug: string; section: { article_id: string } }[];
  // Only this test's own pages (the shared fixtures have links of their own).
  return rows.filter((r) => [PAGE, DRAFT_PAGE].includes(r.section.article_id)).map((r) => `${r.section.article_id}>${r.target_slug}`).sort();
}

const PAGE = 'b0000000-0000-4000-8000-0000000000a1';
const DRAFT_PAGE = 'b0000000-0000-4000-8000-0000000000a2';

beforeEach(async () => {
  await resetFixtures();
  await admin(`insert into public.articles (id, slug, type, title, visibility, status) values
    ($1, 'graph-open', 'location', 'Graph Open', 'players', 'published'),
    ($2, 'graph-draft', 'location', 'Graph Draft', 'players', 'draft')`, [PAGE, DRAFT_PAGE]);
  await admin(`insert into public.article_sections (article_id, position, heading, body, visibility, status) values
    ($1, 1, 'Open', 'See [[Visible Target]].', 'players', 'published'),
    ($1, 2, 'Secret', 'See [[Secret Target]].', 'dm', 'published'),
    ($1, 3, 'Unpublished', 'See [[Unpublished Target]].', 'players', 'draft'),
    ($2, 1, 'Draft page', 'See [[Draft Page Target]].', 'players', 'published')`, [PAGE, DRAFT_PAGE]);
});
afterAll(async () => {
  await resetFixtures();
  await pool.end();
});

describe('graph links over the Data API', () => {
  it('a player gets only links in sections they can read, each with its page id', async () => {
    expect(await links('player')).toEqual([`${PAGE}>visible-target`]);
  });

  it('the DM gets every link; "view as a player" narrows the DM to published player sections', async () => {
    expect(await links('dm')).toEqual([
      `${DRAFT_PAGE}>draft-page-target`,
      `${PAGE}>secret-target`,
      `${PAGE}>unpublished-target`,
      `${PAGE}>visible-target`,
    ].sort());
    expect(await links('dm', true)).toEqual([`${DRAFT_PAGE}>draft-page-target`, `${PAGE}>visible-target`].sort());
  });

  it('an outsider and a revoked player get nothing', async () => {
    expect(await links('outsider')).toEqual([]);
    expect(await links('revoked')).toEqual([]);
  });
});
