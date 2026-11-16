# Fog of war on maps

## Using it (DM)

1. Open a map and select **Fog of war: off** to turn fog on. Players now see the whole map covered.
2. Select **Draw fog area** and click the map around the region, at least three corners. Then
   select **Finish area**.
3. Name the area (only you see the name). Leave **Revealed to players** ticked to uncover it now,
   or untick it to prepare an area you will reveal later.
4. The **Fog areas** list beside the map reveals or hides an area with one click. **edit** renames
   or deletes it.

You see the map through a lighter fog. Revealed areas are outlined in green, and areas still under
fog in dashed gold. Players see solid fog with only the revealed areas clear. Turning fog off shows
players the whole map again; your areas are kept for next time.

## What it protects, and what it does not

- Players receive **only revealed areas**, and only on maps they can see. Row Level Security
  enforces this in the database (`map_fog_areas`, policy `fog_read`). Names and shapes of areas
  still under fog never reach a player's browser.
- Only the DM can draw, reveal, hide or delete areas, or turn fog on and off.
- **The fog is drawn over the full map image in the player's browser.** A player who opens the
  image file directly can see under the fog. Use it for table immersion. For a true secret, such as
  a hidden fortress, keep it off the image you upload: upload a separate map, or add it later as a
  detail map.
- **Markers keep their own visibility.** A player-visible marker inside a fogged area is still
  shown. Keep markers in unexplored regions **DM only** until the party gets there.

## Technical notes

- Migration `20261111001100_map_fog.sql` adds `maps.fog_enabled` and the table `map_fog_areas`.
  An area stores polygon corners in image pixels, like markers: 3 to 200 points; its visibility is
  `players` when revealed and `dm` when fogged.
- The fog is an SVG overlay. Revealed areas are cut out with a mask, so overlapping areas stay
  clear.
- Tests: `tests/db/map-fog.test.ts` (policies), `tests/db/privacy.test.ts` (no fogged area leaks),
  `tests/e2e/map-fog.spec.ts` (draw, reveal, hide, player view).
