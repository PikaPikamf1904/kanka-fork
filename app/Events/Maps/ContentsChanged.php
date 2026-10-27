<?php

namespace App\Events\Maps;

use App\Enums\Visibility;
use App\Http\Resources\Maps\Explore\GroupResource;
use App\Http\Resources\Maps\Explore\LayerResource;
use App\Models\Map;
use App\Models\Scopes\VisibilityIDScope;
use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithBroadcasting;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PresenceChannel;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Contracts\Broadcasting\ShouldRescue;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class ContentsChanged implements ShouldBroadcastNow, ShouldRescue
{
    use Dispatchable;
    use InteractsWithBroadcasting;
    use InteractsWithSockets;
    use SerializesModels;

    public function __construct(
        public Map $map,
        public bool $includeRestricted = false,
    ) {
        $this->broadcastVia('reverb');
    }

    /**
     * @return array<int, Channel>
     */
    public function broadcastOn(): array
    {
        return [
            $this->includeRestricted
                ? new PrivateChannel('map.' . $this->map->id . '.admin')
                : new PresenceChannel('map.' . $this->map->id),
        ];
    }

    public function broadcastAs(): string
    {
        return 'MapContentsChanged';
    }

    public function broadcastWith(): array
    {
        $groups = $this->map->groups();
        $layers = $this->map->layers();

        // The acting user (whoever triggered the save) may not be an admin, so the visibility
        // scope is bypassed and each channel gets the visibilities its audience may see. The
        // admin channel is for campaign admins only, and still leaves out everyone's Self items:
        // those are their creator's alone, and a shared channel can't tell creators apart.
        $visibilities = $this->includeRestricted
            ? [Visibility::All, Visibility::Member, Visibility::Admin, Visibility::AdminSelf]
            : [Visibility::All, Visibility::Member];
        $groups->withoutGlobalScope(VisibilityIDScope::class)->whereIn('visibility_id', $visibilities);
        $layers->withoutGlobalScope(VisibilityIDScope::class)->whereIn('visibility_id', $visibilities);

        return [
            'groups' => GroupResource::collection($groups->get()),
            'layers' => LayerResource::collection(
                $layers->get()->filter(fn ($layer) => $layer->isExplorable())->values()
            ),
        ];
    }
}
