// LOCAL DEVELOPMENT ONLY: load synthetic sample content, a DM account and a player access code
// into the local stack. Credentials are random and written to .local/dev-credentials (gitignored).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { chromium } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(
  fs.readFileSync(path.join(root, '.local/env'), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
if (!env.SUPABASE_URL.startsWith('http://127.0.0.1:')) throw new Error('Refusing to seed anything but the local stack.');

const db = new pg.Client({ connectionString: env.DATABASE_URL });
await db.connect();
// Local stack only: start from empty content (database tests leave their own fixtures behind).
await db.query(`truncate public.revisions, public.map_markers, public.maps, public.timeline_events, public.relations,
  public.redirects, public.article_links, public.article_categories, public.categories, public.dm_notes,
  public.infobox_fields, public.article_sections, public.articles, public.enrollment_attempts,
  public.campaign_members, public.access_codes cascade`);
await db.query("delete from auth.users where email like '%@test.chronicle.invalid' or email like 'player-%@players.chronicle.invalid'");
// Start clean: earlier local runs (or the database tests) may have left these behind.
const dmEmail = 'dm@chronicle.local';
const mapPath = 'media/sample-ember-coast-map.png';
await db.query('delete from auth.users where email = $1', [dmEmail]);
await db.query('delete from public.media where path = $1', [mapPath]);
await db.query(fs.readFileSync(path.join(root, 'supabase/seed/sample.sql'), 'utf8'));

// DM account through the Auth admin API.
const dmPassword = crypto.randomBytes(18).toString('base64url');
const created = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users`, {
  method: 'POST',
  headers: { apikey: env.SUPABASE_SECRET_KEY, 'content-type': 'application/json' },
  body: JSON.stringify({ email: dmEmail, password: dmPassword, email_confirm: true }),
});
if (!created.ok) throw new Error(`Could not create the DM account: ${created.status} ${await created.text()}`);
const dmId = (await created.json()).id;
await db.query("insert into public.campaign_members (user_id, role, display_name) values ($1, 'dm', 'Dungeon Master')", [dmId]);

const playerCode = `sample-${crypto.randomBytes(6).toString('hex')}`;
await db.query(
  "insert into public.access_codes (label, code_hash, created_by) values ('Sample table code', extensions.crypt($1, extensions.gen_salt('bf', 10)), $2)",
  [playerCode, dmId],
);

// A sample map image, drawn as SVG and rendered to PNG (the bucket refuses SVG uploads).
const token = await (await fetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, 'content-type': 'application/json' },
  body: JSON.stringify({ email: dmEmail, password: dmPassword }),
})).json();
const mapSvg = fs.readFileSync(path.join(root, 'scripts/sample-map.svg'), 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
await page.setContent(`<body style="margin:0">${mapSvg}</body>`);
const png = await page.screenshot({ type: 'png' });
await browser.close();
const upload = await fetch(`${env.SUPABASE_URL}/storage/v1/object/chronicle-media/${mapPath}`, {
  method: 'POST',
  headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, authorization: `Bearer ${token.access_token}`, 'content-type': 'image/png', 'x-upsert': 'true' },
  body: png,
});
if (!upload.ok) throw new Error(`Map upload failed: ${upload.status} ${await upload.text()}`);
const media = await db.query(
  "insert into public.media (path, alt, width, height, bytes, content_type, visibility) values ($1, 'Map of the Ember Coast (sample)', 1600, 1100, $2, 'image/png', 'players') returning id",
  [mapPath, png.length],
);
const map = await db.query(
  `insert into public.maps (slug, title, description, media_id, width, height, article_id, visibility, status)
   values ('ember-coast', 'The Ember Coast', 'Sample regional map', $1, 1600, 1100, 'a1000000-0000-4000-8000-000000000005', 'players', 'published') returning id`,
  [media.rows[0].id],
);
await db.query(
  `insert into public.map_markers (map_id, x, y, label, description, article_id, visibility) values
     ($1, 430, 610, 'Port Vellmoor', 'City of a thousand lanterns', 'a1000000-0000-4000-8000-000000000005', 'players'),
     ($1, 360, 820, 'The Ember Spire', 'The Society''s lighthouse', 'a1000000-0000-4000-8000-000000000006', 'players'),
     ($1, 1170, 360, 'The Dragon Nest', 'Do not go in', 'a1000000-0000-4000-8000-000000000007', 'players'),
     ($1, 1010, 470, 'North watchtower', 'DM: captured Quill agent held here', null, 'dm'),
     ($1, 520, 660, 'Smugglers'' tunnel', 'DM: leads to the Ember Spire', null, 'dm'),
     ($1, 900, 560, 'Broker''s safehouse', 'Linked to a DM-only article, so hidden from players', 'a1000000-0000-4000-8000-000000000004', 'players')`,
  [map.rows[0].id],
);
await db.query(
  `insert into public.maps (slug, title, description, width, height, parent_map_id, visibility, status)
   values ('dragon-nest-interior', 'Inside the Dragon Nest', 'DM planning map', 1600, 1100, $1, 'dm', 'draft')`,
  [map.rows[0].id],
);
await db.end();

const creds = `# Local development only. Regenerated each time the local stack is seeded.\nDM_EMAIL=${dmEmail}\nDM_PASSWORD=${dmPassword}\nPLAYER_CODE=${playerCode}\n`;
fs.writeFileSync(path.join(root, '.local/dev-credentials'), creds, { mode: 0o600 });
console.log('Sample content loaded. Local credentials are in .local/dev-credentials');
