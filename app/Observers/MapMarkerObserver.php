<?php

namespace App\Observers;

use App\Models\MapMarker;
use App\Rules\FontAwesomeIcon;
use App\Services\Maps\MarkerAudience;
use enshrined\svgSanitize\Sanitizer;
use Illuminate\Support\Str;

class MapMarkerObserver
{
    use PurifiableTrait;

    public function saving(MapMarker $mapMarker): void
    {
        if ($mapMarker->opacity !== null) {
            $mapMarker->opacity = round($mapMarker->opacity, 1);
        }
        $mapMarker->custom_icon = $this->sanitizeCustomIcon($mapMarker);

        // Only the legacy marker form ever submits size_id explicitly (a preset 1-5, or "custom" 6).
        // v4 map explorer circles never send it, so on update size_id just keeps whatever value is
        // already persisted (the column's DB default) without ever changing — checking dirtiness,
        // not the raw value, is what tells "no size was chosen" apart from "size_id happens to
        // already equal the DB default", which `is_null()` cannot do once a row has round-tripped
        // through the database.
        if ($mapMarker->isDirty('size_id') && $mapMarker->size_id != 6) {
            $mapMarker->circle_radius = null;
        }
    }

    public function saved(MapMarker $mapMarker)
    {
        $mapMarker->map->touchSilently();
    }

    public function created(MapMarker $mapMarker): void
    {
        app(MarkerAudience::class)->after($mapMarker, 'created');
    }

    public function updating(MapMarker $mapMarker): void
    {
        // Who could see the marker before this change: they must hear that it's gone if they
        // can't see it any more, and nobody else may hear about it at all.
        app(MarkerAudience::class)->before($mapMarker);
    }

    public function updated(MapMarker $mapMarker): void
    {
        app(MarkerAudience::class)->after($mapMarker, 'updated');
    }

    public function deleting(MapMarker $mapMarker): void
    {
        app(MarkerAudience::class)->before($mapMarker);
    }

    public function deleted(MapMarker $mapMarker)
    {
        $mapMarker->map->touchSilently();
        app(MarkerAudience::class)->after($mapMarker, 'deleted');
    }

    /**
     * Sanitize the custom icon (i or svg html element)
     *
     * @return string|null
     */
    protected function sanitizeCustomIcon(MapMarker $mapMarker)
    {
        if (empty($mapMarker->custom_icon)) {
            return null;
        }

        if (Str::startsWith($mapMarker->custom_icon, ['<svg', '<?xml'])) {
            // svg-sanitize <=0.22 can be fooled by DTD entities (GHSA-9rjx-3jch-6vjf,
            // GHSA-v383-3rw5-q8rf), and an icon never needs a DTD, so refuse any outright.
            if (preg_match('/<!\s*(DOCTYPE|ENTITY|ATTLIST|ELEMENT)/i', $mapMarker->custom_icon)) {
                return null;
            }
            $sanitizer = new Sanitizer;
            $cleanSvg = $sanitizer->sanitize($mapMarker->custom_icon);
            if ($cleanSvg !== false) {
                return $cleanSvg;
            } else {
                return null;
            }
        } elseif (Str::startsWith($mapMarker->custom_icon, '<i ')) {
            return $this->purify($mapMarker->custom_icon);
        } elseif (Str::startsWith($mapMarker->custom_icon, ['fa-', 'ra '])) {
            // A bare class list has no markup for HTMLPurifier to act on, so a quote-breakout
            // payload like `fa-solid fa-skull" onmousehover="alert(1)` would pass purify()
            // untouched - it's rendered by concatenating this value straight into a
            // class="..." attribute (LeafletCanvas.vue, markerIcon()), so only a strict
            // charset whitelist actually protects those sinks. This is the last line of
            // defense: it also has to catch data written outside StoreMapMarker/StoreMapPreset
            // validation, eg. campaign import (MapMapper) writes custom_icon directly.
            return preg_match(FontAwesomeIcon::SAFE_CLASS_PATTERN, $mapMarker->custom_icon)
                ? $mapMarker->custom_icon
                : null;
        }

        return null;
    }
}
