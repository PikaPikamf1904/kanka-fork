# Give this to ChatGPT with an approved Gazette package

Paste everything below the line into ChatGPT (with the Chronicle connection on), then paste or attach the approved package.

---

You are submitting DM-approved Goblin Gazette stories to Chronicle. Use only the Chronicle tool
`chronicle_draft_gazette_story`, once per story.

Rules:
1. Send each story **exactly as written**. Do not rewrite, shorten, summarise, reorder or "improve" anything. Do not add the
   package's instructions or this prompt to a story. Do not invent stories.
2. Fields: `headline` = the story's headline. `deck` = its italic subtitle line. `body` = everything after the byline, in
   Markdown, unchanged (the `###` headings, lists, quotes and bold stay). Leave `opening` empty.
3. `reporter` is the key whose name and title match the story's byline, from the tool's own list. If no key matches the
   byline exactly, stop and ask the DM; do not pick a near one.
4. `reliability` is `rumor` for "Rumor" and `satire` for "Satire".
5. `section` is the one the DM named for that story. Satire pieces use `local` (their reliability makes them display as "Editorial").
6. `suggested_publish_at` is that story's date at 05:45 Arizona time, written with the offset `-07:00`
   (for example `2026-12-01T05:45:00-07:00`). It is only a suggestion. If a date is in the past, still send it; the DM will choose.
7. If the tool says a headline already exists, do not retry or change the headline: report it to the DM.
8. You cannot approve, schedule or print. When all stories are sent, tell the DM to open Chronicle → DM → News desk →
   "Proposed by an assistant", read the stories, and approve them together. List what you sent: headline, reporter key,
   section, reliability, suggested time.

The six approved stories (this week):

| Story | Reporter key | Section | Reliability | Suggested time |
|---|---|---|---|---|
| Dragon Army Convoy Defeated; Two Soldiers Demonstrate Remarkable Running Ability | `gribble` (Senior Military Correspondent) | `war` | `rumor` | 2026-11-26T05:45:00-07:00 |
| Wheelwatch Falls Silent; Experts Agree That Something Has Probably Happened | `snikkit` (Military Affairs Editor) | `war` | `rumor` | 2026-11-27T05:45:00-07:00 |
| Holy Water: Sacred Relic, Adventuring Equipment, or Extremely Expensive Beverage? | `bogwart` | `local` | `satire` | 2026-11-28T05:45:00-07:00 |
| Five Bells in the Darkness: Mysterious Sounds Disturb Magical Communications | `gribble-investigative` (Investigative Correspondent) | `rumors` | `rumor` | 2026-11-29T05:45:00-07:00 |
| Local Mushroomfolk Raise Difficult Questions for Krynn's Culinary Community | `snikkit-food` (Food and Cultural Affairs Correspondent) | `local` | `satire` | 2026-11-30T05:45:00-07:00 |
| The Black Rose Returns: Mysterious Knight Sighted Near Kalaman | `gribble-senior-investigative` (Senior Investigative Correspondent) | `rumors` | `rumor` | 2026-12-01T05:45:00-07:00 |

(Section and reliability are the DM's choices for the first week. For later weeks, the DM states them.)
