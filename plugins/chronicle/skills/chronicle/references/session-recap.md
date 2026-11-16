# Preparing a session recap

Input: a session transcript (or notes) the DM gives you, and the session's play date.

## 1. Extract events, with evidence

Go through the transcript in order. For each in-game event, note:

- what happened, in one plain sentence
- the start and end timestamps of the evidence (`hh:mm:ss–hh:mm:ss`)
- the status: `table_confirmed` if it clearly happened at the table, `transcript_uncertain` if
  the audio is unclear or the speaker is not identified, `planned_unplayed` if it was only
  discussed as a plan
- open questions (who did it, what was decided)

Leave out:

- table talk, rules chat, breaks, jokes about real life
- players' personal information of any kind
- dice results unless they are spoken clearly and matter to the story

Correct an obvious speech-recognition error only when another source supports the correction,
for example an existing Chronicle page with the right spelling. Otherwise keep the transcript's
form and flag it.

## 2. Separate outcomes from open threads

An unresolved decision stays unresolved. Write "The party has not decided whether to …", not
what they will probably do. A warning the party received is a warning, not an attack that
happened.

## 3. Check Chronicle

- `chronicle_find_duplicates` for every named person, place and item.
- `chronicle_get_character` for each player character involved, to use their recorded names.
- `chronicle_list_sessions` to find the previous session and number this one.

## 4. Propose, as drafts

Build one change set with `chronicle_preview_changes`:

- `create_article` for the session page (type `session`), then `patch_article` on the same slug
  with `fields.session_date` (YYYY-MM-DD), and `upsert_section` for sections such as *Summary*,
  *Events*, *Open threads*.
- `upsert_section` or `upsert_infobox_field` on existing character pages for recorded changes
  (for example a curse the character received). Keep secret mechanics in a section the DM can
  keep DM-only; you cannot publish anything.
- `add_relation` for new connections the session established.
- a `provenance` object on each section and field, with the status as `kind` and the
  timestamps as `reference` (for example `"session 14 transcript 00:41:10-00:42:30"`), so the
  DM can trace every fact with `chronicle_get_provenance`.

Show the DM the preview, the open questions and anything you deliberately left out. Then follow
the approval steps in SKILL.md.
