# Pictures in Chronicle (DM guide)

Upload → Adjust → Save. No Markdown or addresses to type.

## Where the buttons are

| Where | Button | What it adds |
|---|---|---|
| Any page editor (character, location, item, session journal, …) | **Portrait** / **Main picture** → *Add image* | The page's main picture. Characters default to a 3:4 portrait. |
| Every section of a page editor | **🖼 Add image** | One picture, with caption, at the cursor. |
| Every section of a page editor | **Add gallery** | Several pictures side by side. |
| News desk → story editor | **Story picture**, **Add image**, **Add gallery** | Picture under the headline (and on the front page for the lead story); pictures in the text. |
| Wiki settings | **Banner** | The wide picture at the top of the main page (16:5). |
| Sidebar → **Media library** | | Every picture you have uploaded. |

## The three steps

1. **Choose.** *Choose a picture from this device* (on a phone this opens the camera roll or camera),
   drag files onto the box on a computer, or pick one from the **Media library** tab.
2. **Adjust.** Pick a shape (Portrait, Landscape, Square, Banner or Whole picture), drag the picture to
   move it in the frame, and zoom with the slider or by pinching. Arrow keys move it; + and − zoom.
   Add a caption (pictures in text) and a short description for screen readers.
3. **Save picture.** The picture is resized (at most 1600 px, 2400 px for the banner), converted to
   WebP and uploaded. Then **Save** the page as usual.

Under each section's text box, every picture has a card: edit its caption or description, move it
earlier or later, or remove it. **Change image**, **Adjust** and **Remove image** do the same for
main pictures and the banner.

## Your artwork is never overwritten

- Cropping or adjusting always saves a **new copy**. The original upload stays in the library unchanged.
- Re-using a library picture as a *Whole picture* uses the same file, without a copy.
- **Remove image** only takes the picture off that page. The file stays in the library.
- The library only lets you **delete** a picture that nothing uses: no page, section, map, banner or
  waiting Gazette revision. Each picture lists where it is used.
- Existing pictures were not moved, renamed or replaced by this feature.

## Who can see a picture

Every upload starts **DM only**. The database (not the website) makes a picture visible to players
only while it is used by something they can read:

- the main picture of a published, player-visible page;
- a picture in a **published, player-visible section** of a **published, player-visible** page;
- a published, player-visible map;
- the main-page banner.

A picture in a DM-only section, a draft section, a draft page, an unprinted Gazette story or a waiting
Gazette revision stays DM-only, for the file as well as its details. Unpublishing a page, hiding a
section or deleting the picture from the text hides it again at once. A player who already opened a
picture keeps its link for at most 10 minutes (signed links cannot be withdrawn).

The library shows *Players can see* or *DM only* on every picture. The artist or source field is
private.

## Limits

- PNG, JPEG, WebP and GIF. Animated GIFs keep only their first frame.
- Supabase free plan: 1 GB of storage in total. A resized picture is usually 50–400 KB.
- Galleries take up to 24 pictures at a time.

## Technical notes

- Migration `supabase/migrations/20261112001400_article_images.sql` extends
  `private.sync_media_visibility` with the rule for pictures in text, adds triggers on
  `article_sections` and `articles`, and adds `media.credit` and `media.original_name`. Additive;
  rollback statements are in its header.
- Pictures in text are stored as `![description](media:media/<id>.webp "caption")`. Pictures on
  consecutive lines form a gallery.
- Code: `src/components/images/` (picker, cropper, fields), `src/pages/dm/MediaLibrary.tsx`,
  `src/lib/mediaMarkdown.ts`, `src/lib/image.ts`.
- Tests: `tests/db/article-images.test.ts` (who can see what), `src/lib/mediaMarkdown.test.ts`,
  `tests/e2e/images.spec.ts` (desktop and phone, with a player check).
- Screenshots (synthetic): `docs/chronicle/screenshots-images/`.
