# Photos in Chronicle (DM guide)

**Add photo → Adjust → Save.** No addresses, file paths or Markdown to type. Works on a phone.

## Where the buttons are

| Where | Button | What it adds |
|---|---|---|
| Any page editor (character, location, item, session journal, …) | **Portrait** / **Main picture** → *Add photo* | The page's main picture. Characters default to a 3:4 portrait; session journals show it under the title. |
| Every section of a page editor | **🖼 Add photo** | One picture, with caption, at the cursor. |
| Every section of a page editor | **Add gallery** | Several pictures side by side. |
| Page editor, under the sections | **Add gallery section** | A new player section called "Gallery", ready for *Add gallery*. |
| News desk → story editor | **Story picture**, **Add photo**, **Add gallery** | Picture under the headline (and on the front page for the lead story); pictures in the text. |
| Wiki settings | **Banner** | The wide picture at the top of the main page. **Every player sees it**: the editor warns you. |
| Sidebar → **Media library** | | Every picture you have uploaded. |

## The three steps

1. **Choose.** *Choose from device* opens the phone's photos or camera, or the computer's files
   (you can also drop files onto the box on a computer). *Choose from library* reuses a picture
   you uploaded before. JPEG, PNG, WebP and iPhone photos work. If a browser cannot read a HEIC
   file, Chronicle says so and explains how to send it as JPEG.
2. **Adjust.** Pick a shape (Portrait, Landscape, Square, Banner or Whole picture), drag to move it
   in the frame, zoom with the slider or by pinching. Arrow keys move, + and − zoom. For a library
   picture, *Use as is* reuses it unchanged. Add a caption and a short description.
3. **Save.** The picture is resized and uploaded, with progress shown. Then **Save** the page.

**Adjust** next to any picture (main picture, banner or picture in text) opens it again, cropped
from its full-size copy, so cropping twice never loses detail.

If saving fails (for example the connection drops), Chronicle says why and offers **Try again**.
Nothing half-saved is left behind. When several photos are saved together and one fails, the
others are kept and you can **Use the N saved**. Pressing Save twice saves once.

## Your artwork is never lost

- Each new photo is stored twice: a **private full-size copy** (resized to at most 2560 px) for
  cropping again later, and the picture pages show (at most 1600 px; 2400 px for the banner).
- Adjusting saves a **new** crop. The earlier crop and the full-size copy stay in the library.
- **Remove photo** only takes the picture off that page. The file stays in the library.
- The library lists where each picture is used. A picture in use **cannot be deleted**, by the
  website or any other route: page picture, map, banner, picture in text, a waiting Gazette
  revision, or a full-size copy still used by a crop. Deleting an unused picture also removes its
  full-size copy when nothing else uses it.

## Who can see a photo

Every upload starts **DM-only**. The database (not the website) shows a picture to players only
while something they can read uses it:

- the main picture of a published, player-visible page;
- a picture in a **published, player-visible section** of a **published, player-visible** page;
- a published, player-visible map;
- the main-page banner.

Anything else stays DM-only, for the file as well as its library entry. That includes DM-only
sections, drafts, unprinted Gazette stories and waiting revisions. Hiding a page or section, or
removing the picture, hides it again at once.

- **Full-size copies are always private,** even when their crop is shown to players. The database
  refuses to make them visible.
- **Credit, original file name and crop details are private.** They live in a separate DM-only
  table, so a player who may see a picture still cannot read them.
- **Anonymous visitors get nothing.**
- **Assistant connections (ChatGPT, Codex) cannot upload, change or delete photos.** Managing photos
  is a website action for the DM.
- **Links expire.** Picture links last 10 minutes. A picture shown after its link expired fetches a
  fresh one, so pages left open keep their pictures. A player who already opened a picture keeps
  that link for at most 10 minutes after it is hidden.

## Limits

- An animated GIF keeps only its first frame.
- Supabase free plan: 1 GB of storage. A photo usually takes 0.2–1.5 MB including its full-size copy.
- Galleries take up to 24 photos at a time.

## Technical notes

- Migrations:
  - `20261112001400_article_images.sql`: pictures in text follow their section's visibility.
  - `20261112052528_resync_reparented_section_media.sql` (Terra, CH-104 partial).
  - `20261113000100_photo_library.sql`:
    - `media_private` (credit, original name, crop, source link; DM-only);
    - `media.role` (`display` or `source`; a source is always DM-only);
    - `register_photo` (atomic, only for files that really exist in Storage);
    - delete guard for pictures in use, and assistant-connection guards;
    - Storage rules: website DM only, `media/` and `sources/` folders, no deleting registered files.
  - `20261113000300_photo_integrity.sql`: registered files cannot be moved, renamed, overwritten or
    re-uploaded; page history, pending proposals and waiting Gazette revisions count as "in use";
    attaching and deleting at the same moment never leaves a page pointing at a deleted file;
    assistant connections cannot read stored files or private photo details.
- Unfinished uploads: if an upload's answer is lost or its cleanup fails, the Media Library lists
  files older than 10 minutes that have no library entry under "Unfinished uploads", with a button
  to remove them. Nothing registered is ever listed there.
- Code: `src/components/images/` (picker, cropper, fields), `src/pages/dm/MediaLibrary.tsx`,
  `src/lib/api.ts` (`savePhoto`), `src/lib/image.ts`, `src/lib/mediaMarkdown.ts`.
- Tests:
  - `tests/db/photo-library.test.ts`: registration, privacy, delete guard, assistant and Storage rules.
  - `tests/db/photo-storage-api.test.ts`: real GoTrue, Storage and Data API (including move,
    overwrite and re-upload attempts, and assistant tokens).
  - `tests/db/photo-integrity.test.ts`: in-use rules and two-session attach/delete races.
  - `tests/db/article-images.test.ts`: pictures in text.
  - `tests/e2e/photos.spec.ts` and `tests/e2e/images.spec.ts`: desktop and phone.
  - `src/components/images/crop.test.ts`, `src/lib/mediaMarkdown.test.ts`.
- Screenshots (synthetic): `docs/chronicle/screenshots-photos/`, `docs/chronicle/screenshots-images/`.
