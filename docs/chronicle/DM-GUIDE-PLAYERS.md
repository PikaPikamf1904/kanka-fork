# Chronicle: DM guide to players, journals and feedback

Status: this describes the Chronicle features on the development branch. They are **not deployed**.

This guide is for the Dungeon Master (DM). It covers three areas: inviting players, reading Character Journals, and the player feedback inbox.

## Inviting players

Open **Player access** (route `/dm/access`) from the DM menu. The **Invite players** panel is at the top of the page.

### Creating a link

1. Type the player's name (up to 60 characters). The panel suggests **Eliza**, **Sybil**, **Charity** and **Weston**. Each suggestion that is not yet a player or waiting for a link appears as an **Invite <name>** button.
2. Choose how long the link lasts: **1 day**, **7 days** (the default) or **30 days**.
3. Choose **Create invitation link**, or one of the **Invite <name>** buttons.

Each player gets their own link. A link carries a random code after the `#`, so it does not appear in server logs. The code is stored only as a hash.

- The link is shown **once**, in a box with **Copy link** and, on browsers that support it, **Share…**. Choose **Done** to close the box. If you close it without copying, make a new link with **New link**.
- Send the link privately to that player only. Anyone who has the link can claim it until it is used or expires. The link is the only proof of identity; a name is never enough.
- A link works **once**. Once the player opens it and joins, it cannot be used again.
- A link expires after the time you chose. Expired links are listed under **Expired links**, where you can make a new one.

### What happens when a player uses the link

- The first link for a name **creates that player**. The player appears in the table with status **Active**.
- A player who opens the link on a second device does not get a second account. Use **Link for another device** for that (see below). The new device signs in to the same account, so the player's journal and notes follow them.

### Managing the table

The table lists each invited player with their status and their devices.

| Row or action | What it does |
|---|---|
| **Invited · link valid until …** (waiting) | The player has not joined yet. **New link** replaces the link and makes a new one. **Cancel link** cancels it; the link stops working. |
| **Active** | The player has joined. Each device is listed with its label, when it was added and when it was last seen. |
| **Sign out this device** | Signs out that one device. The player's other devices stay signed in. The device is told it has been signed out and loses access at once. |
| **Link for another device** | Makes a new link for the same player, for another device. If a device link is already waiting, the button reads **Replace device link**, and **Cancel link** appears beside it. |
| **Remove player** | Removes the player from the campaign. Every device of theirs loses access immediately. |

The table shows only the device labels, the dates each device was added and last seen, and the revoked state.

### Access codes

Access codes still work. Codes are stored only as a hash and cannot be shown again. A device that enters a code becomes its own player. Those players appear in the **All members** list on the same page, not in the invitation table. Rotating a code revokes every older code, but devices already in keep their access until you remove them.

## Player journals: /dm/journals

Open **Player journals** from the DM menu (route `/dm/journals`). This is a **read-only** view of every player's **Character Journal** entries, with tags, linked pages and the player's name.

- You can read every player's Character Journal entries. You cannot edit or delete them from this page.
- You **cannot** read a player's **scratchpad**, their **saved pages or reading lists**, or their **private research collections**. Those are visible only to the player.
- A research collection that a player has chosen to **share with the party** is readable by every member, the DM included. Ask your players which of their collections are shared if that matters to you.
- Players can read their own journal entries and change them. The DM's view does not change this.

## Player feedback inbox: /dm/feedback

Open **Player feedback** from the DM menu (route `/dm/feedback`). Only the DM can open this page. Players cannot.

### Boundaries first

The page starts with **Boundaries and discomfort**. This section lists everything a player marked as "Boundaries or discomfort", apart from all other feedback. Read it first. Everything else is listed under **Everything else**.

### Filtering and triage

- **Kind**: filter by one of the nine kinds, or show all kinds.
- **Status**: **Open** (the default) hides items marked **Done** or **Closed**. You can also choose one status or **All**. Statuses are **New**, **Read**, **Being worked on**, **Done** and **Closed**.
- **Search**: searches the text of the feedback.
- For each item, set the **Status** and **Priority** (Not set, Low, Normal or High).

### Notes and replies

Open **Notes** on an item to see its controls.

- **Private note**: only you see this. It is saved on the item.
- **Reply**: appears only for **signed** feedback. Your reply appears on the player's **Feedback** page under their own feedback. Replies are not possible for anonymous feedback.
- **Delete**: removes the item for good after a confirmation.

### Who sent it

- Signed feedback shows "From <name>", with the date.
- Anonymous feedback shows "Anonymous". The database does not hold the sender's account, name or time of day, so you cannot find out who sent it from this page.

### Where it goes

Nothing leaves the site. Feedback is not shared with other players, is not searchable from the wiki, is not shown in the knowledge graph, and is not sent to any outside service. For the exact fields stored and the limits of anonymity, see `FEEDBACK-PRIVACY.md`.
