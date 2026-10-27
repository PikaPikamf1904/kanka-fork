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
 * What a user may see on the campaign's maps changed (their permissions or roles, an entity's
 * privacy), so any map they have open should reload its markers through the API. The message
 * says nothing about what changed.
 */
class MapMarkersResync implements ShouldBroadcastNow, ShouldDispatchAfterCommit, ShouldRescue
{
    use Dispatchable;
    use InteractsWithBroadcasting;
    use InteractsWithSockets;

    /**
     * @param  array<int, int>  $userIds
     */
    public function __construct(
        public int $campaignId,
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
        return 'MapMarkersResync';
    }

    public function broadcastWith(): array
    {
        return ['campaign_id' => $this->campaignId];
    }
}
