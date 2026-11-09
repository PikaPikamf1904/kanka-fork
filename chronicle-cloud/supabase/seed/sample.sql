-- SYNTHETIC SAMPLE CONTENT for local previews and tests. Not real campaign data and not canon:
-- every name here is invented. Load only into a local or disposable project.

update public.campaign_settings set
  title = 'Chronicle',
  tagline = 'Sample campaign: a port city, a scholars'' guild, and a dragon nest no one should enter',
  overview = 'This is **synthetic sample content** for previewing Chronicle. Replace it with your own campaign.

The party arrived in [[Port Vellmoor]] chasing rumours of the [[Lantern of Seven Stars]]. Now the [[Silver Quill Society]] wants their help with something far more dangerous: [[Operation Emberfall]].';

insert into public.categories (id, slug, name, kind, visibility, description) values
  ('c1000000-0000-4000-8000-000000000001', 'the-party', 'The party', 'category', 'players', 'Player characters.'),
  ('c1000000-0000-4000-8000-000000000002', 'port-vellmoor', 'Port Vellmoor', 'category', 'players', 'People and places of the port.'),
  ('c1000000-0000-4000-8000-000000000003', 'silver-quill', 'Silver Quill Society', 'category', 'players', ''),
  ('c1000000-0000-4000-8000-000000000004', 'villains', 'Villains', 'category', 'dm', 'Who is really behind it all.'),
  ('c1000000-0000-4000-8000-000000000005', 'emberfall', 'Operation Emberfall', 'tag', 'players', ''),
  ('c1000000-0000-4000-8000-000000000006', 'nest-intel', 'Nest intelligence', 'tag', 'dm', '');

insert into public.articles (id, slug, type, title, subtitle, summary, visibility, status, is_featured, is_party_member, importance, session_date) values
  ('a1000000-0000-4000-8000-000000000001', 'kaela-brightwind', 'character', 'Kaela Brightwind', 'Ranger of the northern marches', 'A sharp-eyed ranger who has never lost a trail. Sample player character.', 'players', 'published', false, true, 50, null),
  ('a1000000-0000-4000-8000-000000000002', 'doran-ashforge', 'character', 'Doran Ashforge', 'Dwarven smith and reluctant hero', 'A smith who swore never to forge a weapon again. Sample player character.', 'players', 'published', false, true, 50, null),
  ('a1000000-0000-4000-8000-000000000003', 'captain-merrin-vael', 'character', 'Captain Merrin Vael', 'Harbourmaster of Port Vellmoor', 'The harbourmaster who hired the party, and who always seems to know which ships will sink.', 'players', 'published', true, false, 80, null),
  ('a1000000-0000-4000-8000-000000000004', 'the-masked-broker', 'character', 'The Masked Broker', 'Information dealer', 'DM-ONLY NPC: the party has not met them yet.', 'dm', 'published', false, false, 90, null),
  ('a1000000-0000-4000-8000-000000000005', 'port-vellmoor', 'location', 'Port Vellmoor', 'City of a thousand lanterns', 'A crowded trading port on the edge of the Ember Coast.', 'players', 'published', true, false, 90, null),
  ('a1000000-0000-4000-8000-000000000006', 'the-ember-spire', 'location', 'The Ember Spire', 'Lighthouse of the Silver Quill', 'A lighthouse that has not shone in forty years, now the Society''s archive.', 'players', 'published', false, false, 60, null),
  ('a1000000-0000-4000-8000-000000000007', 'the-dragon-nest', 'location', 'The Dragon Nest', 'Caldera of the Ember Coast', 'A volcanic caldera where dragons are said to roost. Nobody who went in has come back to describe it.', 'players', 'published', true, false, 95, null),
  ('a1000000-0000-4000-8000-000000000008', 'silver-quill-society', 'faction', 'Silver Quill Society', 'Scholars, archivists and spies', 'A guild of scholars that collects every secret written down on the Ember Coast.', 'players', 'published', true, false, 70, null),
  ('a1000000-0000-4000-8000-000000000009', 'the-ashen-hand', 'faction', 'The Ashen Hand', 'Cult of the Nest', 'DM-ONLY faction.', 'dm', 'published', false, false, 85, null),
  ('a1000000-0000-4000-8000-00000000000a', 'lantern-of-seven-stars', 'item', 'Lantern of Seven Stars', 'Relic of the old lighthouse', 'A lantern whose seven panes each show a different star.', 'players', 'published', false, false, 60, null),
  ('a1000000-0000-4000-8000-00000000000b', 'operation-emberfall', 'quest', 'Operation Emberfall', 'Get into the Dragon Nest, and out again', 'The Silver Quill Society has asked the party to recover a ledger from inside the Dragon Nest.', 'players', 'published', true, false, 100, null),
  ('a1000000-0000-4000-8000-00000000000c', 'dossier-nest-commander', 'dossier', 'Dossier: The Nest Commander', 'Classification: DM eyes only', 'Planning notes for the commander of the Nest garrison.', 'dm', 'draft', false, false, 70, null),
  ('a1000000-0000-4000-8000-00000000000d', 'session-1-smoke-over-vellmoor', 'session', 'Session 1: Smoke over Vellmoor', 'The party arrives', 'The party reached Port Vellmoor the night the harbour caught fire.', 'players', 'published', false, false, 10, '2026-10-03'),
  ('a1000000-0000-4000-8000-00000000000e', 'session-2-the-quills-bargain', 'session', 'Session 2: The Quill''s Bargain', 'An offer from the archivists', 'The Silver Quill Society made the party an offer they could not easily refuse.', 'players', 'published', false, false, 10, '2026-10-17'),
  ('a1000000-0000-4000-8000-00000000000f', 'session-3-draft', 'session', 'Session 3: Into the Caldera', 'Draft recap', 'Draft: not yet written up.', 'players', 'draft', false, false, 10, '2026-10-31'),
  ('a1000000-0000-4000-8000-000000000010', 'the-three-moons', 'lore', 'The Three Moons', 'Sample lore', 'Three moons cross the sky over the Ember Coast: one silver, one red, and one that only the wise can see.', 'players', 'published', true, false, 40, null);

insert into public.infobox_fields (article_id, position, label, value, visibility) values
  ('a1000000-0000-4000-8000-000000000001', 1, 'Race', 'Half-elf', 'players'),
  ('a1000000-0000-4000-8000-000000000001', 2, 'Class', 'Ranger', 'players'),
  ('a1000000-0000-4000-8000-000000000001', 3, 'Affiliation', '[[Silver Quill Society]] (recruit)', 'players'),
  ('a1000000-0000-4000-8000-000000000002', 1, 'Race', 'Dwarf', 'players'),
  ('a1000000-0000-4000-8000-000000000002', 2, 'Class', 'Fighter', 'players'),
  ('a1000000-0000-4000-8000-000000000003', 1, 'Race', 'Human', 'players'),
  ('a1000000-0000-4000-8000-000000000003', 2, 'Occupation', 'Harbourmaster', 'players'),
  ('a1000000-0000-4000-8000-000000000003', 3, 'Location', '[[Port Vellmoor]]', 'players'),
  ('a1000000-0000-4000-8000-000000000003', 4, 'Status', 'Alive', 'players'),
  ('a1000000-0000-4000-8000-000000000003', 5, 'True identity', 'Agent of [[The Masked Broker]]', 'dm'),
  ('a1000000-0000-4000-8000-000000000005', 1, 'Region', 'Ember Coast', 'players'),
  ('a1000000-0000-4000-8000-000000000005', 2, 'Ruler', 'The Harbour Council', 'players'),
  ('a1000000-0000-4000-8000-000000000005', 3, 'Population', 'About 30,000', 'players'),
  ('a1000000-0000-4000-8000-000000000007', 1, 'Region', 'Ember Coast', 'players'),
  ('a1000000-0000-4000-8000-000000000007', 2, 'Danger', 'Extreme', 'players'),
  ('a1000000-0000-4000-8000-000000000007', 3, 'Garrison', 'Forty soldiers of [[The Ashen Hand]], two young dragons', 'dm'),
  ('a1000000-0000-4000-8000-000000000008', 1, 'Leadership', 'The Archivist', 'players'),
  ('a1000000-0000-4000-8000-000000000008', 2, 'Headquarters', '[[The Ember Spire]]', 'players'),
  ('a1000000-0000-4000-8000-000000000008', 3, 'True aims', 'They want the ledger to blackmail the Harbour Council.', 'dm'),
  ('a1000000-0000-4000-8000-00000000000a', 1, 'Item type', 'Wondrous item', 'players'),
  ('a1000000-0000-4000-8000-00000000000a', 2, 'Owner', '[[Kaela Brightwind]]', 'players'),
  ('a1000000-0000-4000-8000-00000000000b', 1, 'Status', 'Active', 'players'),
  ('a1000000-0000-4000-8000-00000000000b', 2, 'Given by', '[[Silver Quill Society]]', 'players'),
  ('a1000000-0000-4000-8000-00000000000b', 3, 'Objective', 'Recover the ledger from [[The Dragon Nest]]', 'players'),
  ('a1000000-0000-4000-8000-00000000000d', 1, 'Session', '1', 'players'),
  ('a1000000-0000-4000-8000-00000000000e', 1, 'Session', '2', 'players');

insert into public.article_sections (article_id, position, heading, body, visibility, status) values
  ('a1000000-0000-4000-8000-000000000001', 1, 'Background', 'Kaela grew up tracking wolves in the northern marches before following a trail of burned villages to the coast. She carries the [[Lantern of Seven Stars]].', 'players', 'published'),
  ('a1000000-0000-4000-8000-000000000002', 1, 'Background', 'Doran left his clan''s forge after a blade he made was used in a massacre. He now works with [[Kaela Brightwind]].', 'players', 'published'),
  ('a1000000-0000-4000-8000-000000000003', 1, 'Personality', 'Gruff, generous with coin, stingy with answers. Keeps a ledger of every ship that enters the harbour.', 'players', 'published'),
  ('a1000000-0000-4000-8000-000000000003', 2, 'Known history', 'Merrin hired the party after the fire in [[Session 1: Smoke over Vellmoor|session one]] and pointed them towards the [[Silver Quill Society]].', 'players', 'published'),
  ('a1000000-0000-4000-8000-000000000003', 3, 'Secrets', 'Merrin set the harbour fire on the orders of [[The Masked Broker]], to destroy the shipping records. If the party finds the ledger, Merrin will try to steal it.', 'dm', 'published'),
  ('a1000000-0000-4000-8000-000000000003', 4, 'Next session', 'Merrin offers a ship, but it is rigged to sink.', 'players', 'draft'),
  ('a1000000-0000-4000-8000-000000000004', 1, 'Who they are', 'The Broker sells secrets to both the Society and the Ashen Hand.', 'players', 'published'),
  ('a1000000-0000-4000-8000-000000000005', 1, 'Description', 'Lantern-lit streets climb from the docks to the old city walls. The harbour smells of tar and smoke since the fire.', 'players', 'published'),
  ('a1000000-0000-4000-8000-000000000005', 2, 'Landmarks', E'- The burned harbour office\n- [[The Ember Spire]], on the northern cliffs\n- The Lantern Market', 'players', 'published'),
  ('a1000000-0000-4000-8000-000000000005', 3, 'Hidden places', 'A smugglers'' tunnel runs from the harbour office cellar to the Ember Spire.', 'dm', 'published'),
  ('a1000000-0000-4000-8000-000000000006', 1, 'Description', 'The Silver Quill keeps its archive on every floor of the old lighthouse.', 'players', 'published'),
  ('a1000000-0000-4000-8000-000000000007', 1, 'Description', 'A ring of black cliffs around a lake of cooling lava. Ash falls like snow.', 'players', 'published'),
  ('a1000000-0000-4000-8000-000000000007', 2, 'What the party knows', 'Supply wagons go in every tenth day. Smoke signals are used to call the dragons.', 'players', 'published'),
  ('a1000000-0000-4000-8000-000000000007', 3, 'Defenses', 'The supply road is watched from three towers. The ledger is in the commander''s quarters, behind a glyph that burns anyone without an Ashen Hand token.', 'dm', 'published'),
  ('a1000000-0000-4000-8000-000000000008', 1, 'Overview', 'The Society trades favours for information and information for favours. Its members wear a silver quill pin.', 'players', 'published'),
  ('a1000000-0000-4000-8000-000000000009', 1, 'Overview', 'A cult that believes the dragons of the Nest are gods. Their token is a hand dipped in ash.', 'players', 'published'),
  ('a1000000-0000-4000-8000-00000000000a', 1, 'Description', 'Each pane glows when its star is above the horizon.', 'players', 'published'),
  ('a1000000-0000-4000-8000-00000000000a', 2, 'True power', 'When all seven panes are lit, it reveals invisible writing, including the ledger''s hidden pages.', 'dm', 'published'),
  ('a1000000-0000-4000-8000-00000000000b', 1, 'Objective', 'Enter [[The Dragon Nest]], find the ledger, and bring it to [[The Ember Spire]].', 'players', 'published'),
  ('a1000000-0000-4000-8000-00000000000b', 2, 'Known clues', E'1. Supply wagons enter every tenth day.\n2. The Ashen Hand uses smoke signals.\n3. Someone in Port Vellmoor wants the ledger destroyed.', 'players', 'published'),
  ('a1000000-0000-4000-8000-00000000000b', 3, 'Possible approaches', 'Disguise, a forged supply manifest, or a climb over the north cliffs.', 'players', 'published'),
  ('a1000000-0000-4000-8000-00000000000b', 4, 'What is really going on', 'The Society plans to betray the party once the ledger is delivered. [[Captain Merrin Vael]] will try to intercept them at the docks.', 'dm', 'published'),
  ('a1000000-0000-4000-8000-00000000000c', 1, 'Summary', 'Commander Vessa Rook, loyal to the Ashen Hand, fears the dragons more than the cult.', 'dm', 'draft'),
  ('a1000000-0000-4000-8000-00000000000c', 2, 'Leads', E'- Bribe the quartermaster\n- Free the captured Quill agent in the north tower', 'dm', 'draft'),
  ('a1000000-0000-4000-8000-00000000000d', 1, 'Recap', 'The party arrived as the harbour burned, helped put out the fire, and met [[Captain Merrin Vael]].', 'players', 'published'),
  ('a1000000-0000-4000-8000-00000000000d', 2, 'Open questions', 'Who started the fire? Why were the shipping records the first thing to burn?', 'players', 'published'),
  ('a1000000-0000-4000-8000-00000000000e', 1, 'Recap', 'At [[The Ember Spire]] the Archivist asked the party to undertake [[Operation Emberfall]].', 'players', 'published'),
  ('a1000000-0000-4000-8000-00000000000f', 1, 'Recap', 'Draft recap, not yet published.', 'players', 'draft'),
  ('a1000000-0000-4000-8000-000000000010', 1, 'The silver moon', 'Its light is said to favour healers and scholars.', 'players', 'published'),
  ('a1000000-0000-4000-8000-000000000010', 2, 'The red moon', 'Sailors read storms in its colour.', 'players', 'published'),
  ('a1000000-0000-4000-8000-000000000010', 3, 'The unseen moon', 'Only those who have bargained with the Nest can see it.', 'dm', 'published');

insert into public.article_categories (article_id, category_id) values
  ('a1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001'),
  ('a1000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000001'),
  ('a1000000-0000-4000-8000-000000000003', 'c1000000-0000-4000-8000-000000000002'),
  ('a1000000-0000-4000-8000-000000000003', 'c1000000-0000-4000-8000-000000000004'),
  ('a1000000-0000-4000-8000-000000000005', 'c1000000-0000-4000-8000-000000000002'),
  ('a1000000-0000-4000-8000-000000000006', 'c1000000-0000-4000-8000-000000000003'),
  ('a1000000-0000-4000-8000-000000000008', 'c1000000-0000-4000-8000-000000000003'),
  ('a1000000-0000-4000-8000-00000000000b', 'c1000000-0000-4000-8000-000000000005'),
  ('a1000000-0000-4000-8000-000000000007', 'c1000000-0000-4000-8000-000000000005'),
  ('a1000000-0000-4000-8000-000000000007', 'c1000000-0000-4000-8000-000000000006');

insert into public.relations (source_article_id, target_article_id, kind, label, visibility) values
  ('a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000002', 'ally_of', 'Travelling companions', 'players'),
  ('a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000008', 'member_of', 'Recruit', 'players'),
  ('a1000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000005', 'resides_in', '', 'players'),
  ('a1000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000004', 'member_of', 'Secret agent', 'dm'),
  ('a1000000-0000-4000-8000-000000000008', 'a1000000-0000-4000-8000-000000000006', 'controls', 'Headquarters', 'players'),
  ('a1000000-0000-4000-8000-000000000009', 'a1000000-0000-4000-8000-000000000007', 'controls', '', 'dm'),
  ('a1000000-0000-4000-8000-00000000000b', 'a1000000-0000-4000-8000-000000000007', 'involves', '', 'players'),
  ('a1000000-0000-4000-8000-00000000000b', 'a1000000-0000-4000-8000-000000000008', 'involves', '', 'players'),
  ('a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-000000000001', 'related_to', 'Carried by', 'players');

insert into public.redirects (from_slug, article_id, visibility) values
  ('vellmoor', 'a1000000-0000-4000-8000-000000000005', 'players'),
  ('the-firestarter', 'a1000000-0000-4000-8000-000000000003', 'dm');

insert into public.timeline_events (title, date_label, sort_key, body, article_id, visibility, status) values
  ('The Ember Spire goes dark', 'Forty years ago', 10, 'The lighthouse lamp fails and is never relit.', 'a1000000-0000-4000-8000-000000000006', 'players', 'published'),
  ('The Ashen Hand takes the Nest', 'Twelve years ago', 20, 'The cult moves into the caldera.', 'a1000000-0000-4000-8000-000000000009', 'dm', 'published'),
  ('The harbour fire', 'Session 1', 30, 'Fire destroys the harbour office.', 'a1000000-0000-4000-8000-00000000000d', 'players', 'published'),
  ('The Quill''s bargain', 'Session 2', 40, 'The party agrees to Operation Emberfall.', 'a1000000-0000-4000-8000-00000000000e', 'players', 'published'),
  ('Ambush at the docks', 'Planned', 50, 'Merrin''s people wait for the party.', null, 'dm', 'draft');

insert into public.dm_notes (article_id, title, body) values
  ('a1000000-0000-4000-8000-00000000000b', 'Pacing', 'Give the party two sessions of reconnaissance before the break-in.'),
  (null, 'Campaign arc', 'The Broker is the long-term villain. Reveal them no earlier than session 8.');
