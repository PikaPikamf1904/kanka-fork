<?php

namespace App\Events\Maps;

use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithBroadcasting;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Contracts\Broadcasting\ShouldRescue;
use Illuminate\Contracts\Events\ShouldDispatchAfterCommit;
use Illuminate\Foundation\Events\Dispatchable;

/**
 * A marker changed on a map. This only goes to the users who can see the marker (worked out by
 * MarkerAudience), each on their own private channel, and carries nothing but ids and the
 * action: the clients fetch the marker itself through the permission-checked map API.
 */
class MarkerChanged implements ShouldBroadcastNow, ShouldDispatchAfterCommit, ShouldRescue
{
    use Dispatchable;
    use InteractsWithBroadcasting;
    use InteractsWithSockets;

    /**
     * @param  array<int, int>  $userIds
     */
    public function __construct(
        public int $mapId,
        public int $markerId,
        public string $action,
        public array $userIds,
    ) {
        $this->broadcastVia('reverb');
    }

    /**
     * @return array<int, Channel>
     */
    public function broadcastOn(): array
    {
        return array_map(fn (int $id) => new PrivateChannel('users.' . $id . '.maps'), $this->userIds);
    }

    public function broadcastWhen(): bool
    {
        return ! empty($this->userIds);
    }

    public function broadcastAs(): string
    {
        return 'MapMarkerChanged';
    }

    public function broadcastWith(): array
    {
        return [
            'action' => $this->action,
            'id' => $this->markerId,
            'map_id' => $this->mapId,
        ];
    }
}
