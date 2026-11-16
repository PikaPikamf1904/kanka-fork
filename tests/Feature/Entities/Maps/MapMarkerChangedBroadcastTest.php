<?php

use App\Events\Maps\MarkerChanged;
use App\Models\Map;
use App\Models\MapGroup;
use App\Models\MapMarker;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Support\Facades\Event;

it('broadcasts on each recipient\'s private maps channel', function () {
    $event = new MarkerChanged(5, 9, 'created', [1, 7]);

    $channels = $event->broadcastOn();
    expect($channels)->toHaveCount(2);
    expect($channels[0])->toBeInstanceOf(PrivateChannel::class);
    expect(collect($channels)->pluck('name')->all())->toBe(['private-users.1.maps', 'private-users.7.maps']);
    expect($event->broadcastAs())->toBe('MapMarkerChanged');
    expect($event->broadcastWhen())->toBeTrue();
});

it('broadcasts only the action and the ids', function () {
    $payload = new MarkerChanged(5, 9, 'updated', [1])->broadcastWith();

    expect($payload)->toBe(['action' => 'updated', 'id' => 9, 'map_id' => 5]);
});

it('does not broadcast when nobody may see the marker', function () {
    expect(new MarkerChanged(5, 9, 'updated', [])->broadcastWhen())->toBeFalse();
});

it('dispatches MarkerChanged to the DM when a marker is created, updated or deleted', function () {
    $this->asUser()->withCampaign();
    $map = Map::factory()->create(['campaign_id' => 1]);

    Event::fake([MarkerChanged::class]);
    $marker = MapMarker::factory()->create(['map_id' => $map->id]);
    $marker->update(['name' => 'Renamed']);
    $marker->delete();

    foreach (['created', 'updated', 'deleted'] as $action) {
        Event::assertDispatched(MarkerChanged::class, fn ($event) => $event->action === $action
            && $event->markerId === $marker->id
            && $event->mapId === $map->id
            && in_array(1, $event->userIds, true));
    }
});

it('dispatches on a partial move-style update, matching the dedicated move endpoint', function () {
    $this->asUser()->withCampaign();
    $map = Map::factory()->create(['campaign_id' => 1]);
    $marker = MapMarker::factory()->create(['map_id' => $map->id, 'latitude' => 1, 'longitude' => 1]);

    Event::fake([MarkerChanged::class]);
    $marker->update(['latitude' => 42, 'longitude' => 42]);

    Event::assertDispatchedTimes(MarkerChanged::class, 1);
    Event::assertDispatched(MarkerChanged::class, fn ($event) => $event->action === 'updated' && $event->markerId === $marker->id);
});

it('dispatches MarkerChanged when a marker is bulk-patched', function () {
    $this->asUser()->withCampaign();
    $map = Map::factory()->create(['campaign_id' => 1]);
    $marker = MapMarker::factory()->create(['map_id' => $map->id]);

    Event::fake([MarkerChanged::class]);
    $marker->patch(['name' => 'Bulk Renamed']);

    Event::assertDispatchedTimes(MarkerChanged::class, 1);
    expect($marker->fresh()->name)->toBe('Bulk Renamed');
});

it('still converts a group_id of -1 to null when bulk-patched', function () {
    $this->asUser()->withCampaign();
    $map = Map::factory()->create(['campaign_id' => 1]);
    $group = MapGroup::factory()->create(['map_id' => $map->id]);
    $marker = MapMarker::factory()->create(['map_id' => $map->id, 'group_id' => $group->id]);

    $marker->patch(['group_id' => -1]);

    expect($marker->fresh()->group_id)->toBeNull();
});
