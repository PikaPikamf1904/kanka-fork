# Proposing a character update

Example request: "Add what happened to Swift Claw last session."

1. `chronicle_get_character` with the character's slug (use `chronicle_search` or
   `chronicle_list_characters` if you do not know it). Note `character.version`.
   If no page exists, check `chronicle_find_duplicates`, then use
   `chronicle_create_character_draft` with only facts the DM gave you.
2. Decide what changes, and the status of each fact (see SKILL.md, ground rule 3).
3. Preview with `chronicle_preview_changes`:

```json
{
  "change_set": {
    "label": "Swift Claw: session 14 events",
    "source_kind": "dm_confirmed",
    "expected_versions": { "swift-claw": "v7" },
    "changes": [
      {
        "operation": "upsert_section",
        "article_slug": "swift-claw",
        "heading": "Curse",
        "body": "Received the Five-Fold Claim curse during session 14. Its effects are not recorded.",
        "provenance": { "kind": "table_confirmed", "reference": "session 14 transcript 01:12:05-01:13:40" }
      },
      {
        "operation": "upsert_infobox_field",
        "article_slug": "swift-claw",
        "label": "Status",
        "value": "Cursed (Five-Fold Claim)"
      }
    ]
  }
}
```

4. Tell the DM what the preview shows, including any warning (for example a `[[link]]` to a page
   that does not exist), and give them the `review_url`.
5. After approval, apply with a new `idempotency_key`.

Things that are never yours to fill in: who owns an item when the record is unclear, how a
curse works when the DM has not said, what the party will decide next.
