// LOCAL DEVELOPMENT ONLY: load synthetic sample content, a DM account and a player access code
// into the local stack. Credentials are random and written to .local/dev-credentials (gitignored).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { chromium } from '@playwright/test';
import { assertDisposableDatabase, readLocalEnv } from './local-targets.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = readLocalEnv();
await assertDisposableDatabase(env.DATABASE_URL);

const db = new pg.Client({ connectionString: env.DATABASE_URL });
await db.connect();
// Local stack only: start from empty content (database tests leave their own fixtures behind).
await db.query(`truncate public.revisions, public.map_markers, public.maps, public.timeline_events, public.relations,
  public.redirects, public.article_links, public.article_categories, public.categories, public.dm_notes,
  public.infobox_fields, public.article_sections, public.articles, public.enrollment_attempts,
  public.campaign_members, public.access_codes cascade`);
// The settings row references articles (current location), so the cascade above can remove it.
await db.query('insert into public.campaign_settings (id) values (true) on conflict (id) do nothing');
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
  `insert into public.maps (slug, title, description, width, height, parent_map_id, article_id, visibility, status)
   values ('dragon-nest-interior', 'Inside the Dragon Nest', 'DM planning map', 1600, 1100, $1, 'a1000000-0000-4000-8000-000000000007', 'dm', 'draft')`,
  [map.rows[0].id],
);
const town = await db.query(
  `insert into public.maps (slug, title, description, width, height, parent_map_id, article_id, visibility, status)
   values ('port-vellmoor-town', 'Port Vellmoor (town)', 'Sample town map', 1200, 900, $1, 'a1000000-0000-4000-8000-000000000005', 'players', 'published') returning id`,
  [map.rows[0].id],
);
await db.query(
  `insert into public.map_markers (map_id, x, y, label, description, visibility) values
     ($1, 600, 450, 'Harbourmaster''s office', 'Where ships register', 'players')`,
  [town.rows[0].id],
);

// The Goblin Gazette: synthetic stories for the sample world (published ones, plus one unprinted
// draft that names a DM-only character and must never reach players).
const stories = [
  {
    slug: 'fires-on-the-coast-road', title: 'Fires on the Coast Road as Wagons Turn Back',
    subtitle: 'Smoke seen from the harbour walls. Your correspondent watched from behind them.',
    summary: 'Supply wagons bound for [[port-vellmoor|Port Vellmoor]] turned back at dawn yesterday after drivers reported fires along the coast road. The Harbourmaster has doubled the night watch.',
    body: `The smoke was visible from the lantern towers by mid-morning. By noon it had a smell, and by evening it had a rumour attached, which this newspaper will not print, because Mr Snoot says we may not print it until it is bigger.

What is known: four wagons left the inland farms on time. Three came back. The fourth was found later, empty and unharmed, its mule calmly eating the cargo. The drivers say they saw riders on the ridge but did not stop to count them. Neither, in fairness, would I.

[[captain-merrin-vael|Captain Merrin Vael]], the Harbourmaster, told the Gazette that the port has food for some weeks and that "nobody needs to panic, least of all the man from the newspaper." She then asked me to stop following her.

The night watch has been doubled. The lanterns stay lit until dawn. If you have a cellar, this reporter recommends it. I am writing this from one.`,
    news: { section: 'war', reliability: 'confirmed', reporter: 'mossbottom', dateline: 'Port Vellmoor', in_world_date: 'The 9th of Rannmont', issue_number: 2, is_lead: true, review_state: 'approved' },
    published: true,
  },
  {
    slug: 'lights-over-the-spire', title: 'Mysterious Lights Over the Spire: It Is Love, Says Our Columnist',
    subtitle: 'Or signals. Or a lamp. Madame Pinchcheek has narrowed it down.',
    summary: 'Lights have been seen blinking from the top of [[the-ember-spire|the Ember Spire]] after midnight, and this column can reveal that somebody up there is in love.',
    body: `Three blinks, a pause, then two more. Every night this week. The fishermen say it is the [[silver-quill-society|Silver Quill Society]] sending messages. The fishermen also said the herring would be back by spring, so.

My own sources, a baker and a different baker, agree that a courtship is far more likely. Who else stays up that late? Not scholars. I have met scholars. They are asleep by nine with a book on their face.

The Society declined to comment, which is exactly what someone in love would do.`,
    news: { section: 'rumors', reliability: 'rumor', reporter: 'pinchcheek', dateline: 'The Ember Spire', in_world_date: 'The 8th of Rannmont', issue_number: 2, is_lead: false, review_state: 'approved' },
    published: true,
  },
  {
    slug: 'lantern-count-reaches-a-lot', title: 'Lantern Count Reaches “A Lot”, Officials Confirm',
    subtitle: 'Our investigator counted them twice. The numbers did not agree. Draw your own conclusions.',
    summary: 'Port Vellmoor’s famous lanterns now number somewhere between nine hundred and eleven hundred, depending on who is counting and whether they stopped for lunch.',
    body: `The city calls itself the city of a thousand lanterns. This newspaper wanted to know whether that was true. It took two nights.

The first count, from the harbour wall to the fish market, came to 1,041. The second, walking the other way, came to 968. That leaves seventy-three lanterns unaccounted for. Where did they go? Who has them? Why does nobody else find this strange?

The lamplighters' guild says the difference is "because you counted the tavern signs the first time." That is exactly what someone hiding seventy-three lanterns would say.

Inquiries continue. This reporter has been asked to stop climbing the lamp posts.`,
    news: { section: 'local', reliability: 'confirmed', reporter: 'nib', dateline: 'Port Vellmoor', in_world_date: 'The 7th of Rannmont', issue_number: 2, is_lead: false, review_state: 'approved' },
    published: true,
  },
  {
    slug: 'editorial-the-gazette-was-right', title: 'Editorial: The Gazette Was Right All Along',
    subtitle: 'A word from the Editor-in-Chief.',
    summary: 'This newspaper has never been wrong, and the readers who wrote in to say otherwise have been counted.',
    body: `Some readers have suggested that the Gazette exaggerates. The Gazette does not exaggerate. The Gazette reports the truth at a slightly larger size so that it is easier to read.

Others ask why anyone should trust a newspaper run by goblins. Because we were there. Not at the events, necessarily, but nearby, and usually with a pencil.

Last week we told you dragons were mostly harmless and a bit theatrical. We stand by "theatrical".`,
    news: { section: 'local', reliability: 'satire', reporter: 'editor', dateline: '', in_world_date: 'The 1st of Rannmont', issue_number: 1, is_lead: true, review_state: 'approved' },
    published: true,
  },
  {
    slug: 'correction-dragons', title: 'Correction: Dragons Are Not “Mostly Harmless”',
    subtitle: '',
    summary: 'In our first issue the Editor-in-Chief described dragons as "mostly harmless and a bit theatrical". This was wrong.',
    body: `The Gazette regrets the error. The editorial was written before the editor had seen one. He has now seen one, from a considerable distance, and asks us to say that his earlier view "was a test of the readers". It was not.

Readers are advised not to approach [[the-dragon-nest|the Dragon Nest]], with or without a copy of this newspaper.`,
    news: { section: 'corrections', reliability: 'correction', reporter: 'corrections', dateline: '', in_world_date: 'The 9th of Rannmont', issue_number: 2, is_lead: false, review_state: 'approved', corrects: 'editorial-the-gazette-was-right' },
    published: true,
  },
  {
    slug: 'harbourmaster-secret-talks', title: 'Harbourmaster in Secret Talks With a Masked Figure?',
    subtitle: 'Nib has a ledger, a hunch and no sleep.',
    summary: 'An unprinted draft. It names a DM-only character and must never reach players.',
    body: 'Sources place the Masked Broker at the harbour office twice this week. GAZETTEDRAFT.',
    news: { section: 'breaking', reliability: 'rumor', reporter: 'nib', dateline: 'Port Vellmoor', in_world_date: 'The 10th of Rannmont', issue_number: 3, is_lead: false, review_state: 'in_review' },
    published: false,
  },
];
const storyIds = new Map();
for (const st of stories) {
  const a = await db.query(
    `insert into public.articles (slug, type, title, subtitle, summary, visibility, status) values ($1, 'news', $2, $3, $4, 'dm', 'draft') returning id`,
    [st.slug, st.title, st.subtitle, st.summary],
  );
  const id = a.rows[0].id;
  storyIds.set(st.slug, id);
  await db.query(`insert into public.article_sections (article_id, position, heading, body, visibility, status) values ($1, 1, '', $2, 'players', 'published')`, [id, st.body]);
  const n = st.news;
  await db.query(
    `insert into public.news_stories (article_id, section, reliability, reporter, dateline, in_world_date, issue_number, is_lead, review_state, corrects_article_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [id, n.section, n.reliability, n.reporter, n.dateline, n.in_world_date, n.issue_number, n.is_lead, n.review_state, n.corrects ? storyIds.get(n.corrects) : null],
  );
  if (st.published) {
    await db.query(`update public.articles set status = 'published', visibility = 'players', published_at = now() - ($2 || ' hours')::interval where id = $1`, [id, String(stories.indexOf(st))]);
  }
}
await db.query("update public.campaign_settings set current_location_id = 'a1000000-0000-4000-8000-000000000005', current_status = 'Holding Port Vellmoor while the coast road burns. The Quill''s bargain still stands.'");
await db.end();

const creds = `# Local development only. Regenerated each time the local stack is seeded.\nDM_EMAIL=${dmEmail}\nDM_PASSWORD=${dmPassword}\nPLAYER_CODE=${playerCode}\n`;
fs.writeFileSync(path.join(root, '.local/dev-credentials'), creds, { mode: 0o600 });
console.log('Sample content loaded. Local credentials are in .local/dev-credentials');
