<?php

namespace App\Observers;

use App\Events\Maps\ContentsChanged;
use App\Models\Map;
use App\Models\MapGroup;
use App\Services\Maps\MarkerAudience;

class MapGroupObserver
{
    use ReorderTrait;

    public function saving(MapGroup $mapGroup)
    {
        if (! empty($mapGroup->position)) {
            $mapGroup->position = (int) $mapGroup->position;
        } else {
            $lastGroup = $mapGroup->map->groups()->max('position');
            if ($lastGroup) {
                $mapGroup->position = (int) $lastGroup + 1;
            } else {
                $mapGroup->position = 1;
            }
        }
    }

    public function saved(MapGroup $mapGroup)
    {
        $mapGroup->map->touchSilently();
    }

    public function created(MapGroup $mapGroup): void
    {
        $this->reorder($mapGroup);
        $this->broadcastContents($mapGroup->map);
    }

    public function updating(MapGroup $mapGroup): void
    {
        if ($mapGroup->isDirty('visibility_id')) {
            app(MarkerAudience::class)->beforeGroup($mapGroup);
        }
    }

    public function updated(MapGroup $mapGroup): void
    {
        if ($mapGroup->wasChanged('position')) {
            $this->reorder($mapGroup);
        }
        $this->broadcastContents($mapGroup->map);
        if ($mapGroup->wasChanged('visibility_id')) {
            app(MarkerAudience::class)->afterGroup($mapGroup);
        }
    }

    public function deleting(MapGroup $mapGroup): void
    {
        app(MarkerAudience::class)->beforeGroup($mapGroup);
    }

    public function deleted(MapGroup $mapGroup)
    {
        $mapGroup->map->touchSilently();
        $this->broadcastContents($mapGroup->map);
        app(MarkerAudience::class)->afterGroup($mapGroup);
    }

    protected function broadcastContents(Map $map): void
    {
        ContentsChanged::dispatch($map);
        ContentsChanged::dispatch($map, true);
    }
}
