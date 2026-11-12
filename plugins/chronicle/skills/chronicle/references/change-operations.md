# Change operations

`chronicle_preview_changes` takes `{ "change_set": { "label", "source_kind", "expected_versions", "changes": [...] } }`.
Each change has an `operation` and the fields below. Every change to an existing page needs that
page's version, either in `expected_versions` (`{ "<slug>": "v12" }`) or as `expected_version`
on the change.

| operation | fields |
|---|---|
| `create_article` | `slug`, `title`, `type` (lore, character, location, faction, item, quest, session, event, dossier), optional `subtitle`, `summary`, `is_party_member`, `on_exists` (`skip` or `conflict`) |
| `patch_article` | `slug`, `fields`: an object with any of `title`, `subtitle`, `summary`, `is_party_member`, `importance`, `session_date` |
| `upsert_section` | `article_slug`, `heading`, `body`, optional `section_id` (replace that section), `position`, `provenance` |
| `remove_section` | `article_slug`, `section_id` |
| `upsert_infobox_field` | `article_slug`, `label`, `value`, optional `field_id`, `position`, `provenance` |
| `remove_infobox_field` | `article_slug`, `field_id` |
| `add_relation` | `source_slug`, `target_slug`, `kind`, optional `label` |
| `remove_relation` | `relation_id` |
| `add_category_link` / `remove_category_link` | `article_slug`, `category_slug` |
| `add_dm_note` | `article_slug`, `body`, optional `title` |
| `restore_revision` | `article_slug`, `revision_id` |

`provenance` is `{ "kind": "<source kind>", "reference": "<up to 500 characters>" }`. Put the
evidence in `reference`, for example `"session 14 transcript 00:41:10-00:42:30"`. Without it,
the change set's `source_kind` applies. Section and infobox ids come from
`chronicle_get_article`.

Rules the server enforces (you cannot override them):

- New pages, sections and fields are DM-only drafts. Visibility and publish status cannot be set
  through MCP.
- A connected assistant cannot change text players can already read.
- A patch cannot change a page's type, address, visibility or status.
- A restore always comes back as an unpublished draft.
- Limits: 1 MB per change set, 100 pages, 30 sections, 50 fields and 100 KB of text per page.

Body text uses Markdown with wiki links: `[[slug]]` or `[[slug|label]]`.
