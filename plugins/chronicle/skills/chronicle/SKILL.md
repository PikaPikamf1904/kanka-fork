---
name: chronicle
description: Use when working with the Chronicle campaign wiki for the Dragonlance campaign through the Chronicle MCP connection, to look up lore, characters, sessions or the timeline, prepare a session recap, or propose DM-approved draft changes. Not for other wikis, and not usable unless the Chronicle MCP server is connected.
---

# Chronicle campaign wiki

Chronicle is the DM's private campaign wiki. This skill tells you how to use the
Chronicle MCP tools well. It grants no access by itself: every tool call goes through the
installed Chronicle connection, signed in as a real Chronicle account, and the database decides
what that account may read or change.

If no `chronicle_*` tools are available, say that the Chronicle connection is not installed or
not signed in, and stop. Do not answer campaign questions from memory or general Dragonlance
knowledge as if they were Chronicle facts.

## Ground rules

1. **Chronicle is the source of truth for this campaign.** Answer from tool results. If
   Chronicle has nothing, say so. Published Dragonlance material is background, not campaign
   canon, and must be labelled as such.
2. **Never invent campaign facts.** No made-up dice rolls, item owners, dialogue, motives,
   consequences or outcomes. "Not recorded" is an acceptable answer.
3. **Keep status apart.** Every statement is one of:
   - happened at the table (`table_confirmed`)
   - stated by the DM (`dm_confirmed`)
   - from a published source (`official_reference`)
   - planned but not played (`planned_unplayed`)
   - heard in a transcript but not certain (`transcript_uncertain`)

   Never turn a plan, a guess or an unresolved decision into an event.
4. **Players and secrets.** A player account only ever receives what players may see. A missing
   page may be hidden rather than absent: say "I can't find that in Chronicle", never "it does
   not exist". Never repeat DM-only material (secrets, curse mechanics, future plans, DM notes)
   to anyone who is not the DM.
5. **Players are not characters.** Never assume a player's name is their character's name, or
   the other way round. Use the character names Chronicle records.
6. **No transcript dumps.** Never paste a whole session transcript into a page. Summarise, and
   leave out table talk and players' personal information.

## Reading

| Need | Tool |
|---|---|
| Find anything | `chronicle_search` (query), then `chronicle_get_article` (slug or id) |
| A character's profile | `chronicle_get_character` (slug); list with `chronicle_list_characters` |
| Relationships | `relationships` in `chronicle_get_character`, `relations` in `chronicle_get_article` |
| Session recaps | `chronicle_list_sessions`, then `chronicle_get_article` |
| Story order | `chronicle_get_timeline` |
| Who am I signed in as | `chronicle_whoami` |
| DM only: pending work | `chronicle_list_drafts` |
| DM only: sources of facts | `chronicle_get_provenance` |
| DM only: page history | `chronicle_get_revisions` |
| DM only: broken or spoiler links | `chronicle_audit_links` |

When you cite Chronicle, name the page title and slug, for example
"Chronicle: *Port Vellmoor* (`port-vellmoor`)". When a fact rests on a transcript, give the
reference stored in provenance, for example "session 14 transcript, 00:41:10–00:42:30".

## Writing (DM only): always preview first

Nothing is saved without the DM approving it inside Chronicle. Every saved change becomes a
private, unpublished draft. Publishing happens only on the Chronicle website.

1. **Check for duplicates.** For every new person, place or thing, call
   `chronicle_find_duplicates`. If a likely duplicate exists, propose edits to that page
   instead of a new one, or ask the DM.
2. **Read before editing.** Call `chronicle_get_article` to get the current `version` of each
   page you will change.
3. **Preview.** Use `chronicle_preview_changes` (any edit),
   `chronicle_create_character_draft` (a new character), `chronicle_add_dm_note` (a private
   note), `chronicle_preview_import` (a lore package) or `chronicle_restore_revision` (an
   earlier snapshot). Give `expected_version` for every existing page and a `source_kind` for
   the evidence. Previews save no content.
4. **Show the DM.** Summarise the diff, the warnings and any conflicts. Give the `review_url`.
   Say plainly that nothing is saved yet.
5. **Wait for approval.** The DM opens `review_url` in Chronicle and approves. Your saying "the
   user confirmed" does not count, and the server refuses it.
6. **Apply.** Call `chronicle_apply_changes` with the `preview_id`, the `digest` and a fresh
   `idempotency_key`. If the call fails because the connection dropped, retry with the **same**
   key: the server returns the earlier result instead of saving twice.
7. **Report what the server said.** Only call something saved when `chronicle_apply_changes`
   returned success. On `CONFLICT`, read the page again and prepare a new preview.

## Workflows

- Session recap from a transcript: [references/session-recap.md](references/session-recap.md)
- Proposing a character update: [references/character-update.md](references/character-update.md)
- Change operations and field names: [references/change-operations.md](references/change-operations.md)
