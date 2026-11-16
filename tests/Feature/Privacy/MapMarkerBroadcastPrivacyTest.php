<?php

/*
 * Live map updates go out over Reverb. A player must only ever hear about markers they can see
 * in the explorer itself: no name, description or coordinates of a hidden marker, and not even
 * its id or the fact that it changed. These tests look at every MapMarkerChanged event a change
 * dispatches, work out which of its channels each user is allowed to join (by running the real
 * channel authorization callbacks from routes/channels.php), and check what reaches that user.
 */

use App\Enums\Visibility;
use App\Events\Maps\ContentsChanged;
use App\Events\Maps\MapMarkersResync;
use App\Events\Maps\MarkerChanged;
use App\Facades\CampaignLocalization;
use App\Models\Campaign;
use App\Models\CampaignPermission;
use App\Models\CampaignRoleUser;
use App\Models\Character;
use App\Models\Map;
use App\Models\MapGroup;
use App\Models\MapMarker;
use App\Models\User;
use Illuminate\Routing\Route;
use Illuminate\Support\Facades\Broadcast;
use Illuminate\Support\Facades\Event;

require_once __DIR__ . '/support.php';

/**
 * Start a fresh web request inside campaign 1, as the {campaign} route binding would.
 */
function campaignRequest($test): void
{
    $test->asWebRequest();
    $campaign = Campaign::find(1);
    $route = new Route('GET', 'w/{campaign}', fn () => null);
    $route->bind(request());
    $route->setParameter('campaign', $campaign);
    request()->setRouteResolver(fn () => $route);
    CampaignLocalization::forceCampaign($campaign);
}

/**
 * Whether $user passes the authorization callback of a broadcast channel.
 */
function userCanJoinChannel($test, User $user, string $channel): bool
{
    $name = preg_replace('/^(private-|presence-)/', '', $channel);
    foreach (Broadcast::driver()->getChannels() as $pattern => $callback) {
        $regex = '/^' . preg_replace('/\\\\\{[^}]+\\\\\}/', '([^.]+)', preg_quote($pattern, '/')) . '$/';
        if (! preg_match($regex, $name, $matches)) {
            continue;
        }
        array_shift($matches);
        // Each channel check is a fresh request in production: don't let the permissions
        // cached for the previous user answer for this one.
        campaignRequest($test);

        return (bool) $callback($user, ...$matches);
    }

    return false;
}

/**
 * The payloads of every dispatched MapMarkerChanged event that reaches $user.
 *
 * @return array<int, array<string, mixed>>
 */
function markerBroadcastsReaching($test, User $user, array $broadcasts): array
{
    $reaching = [];
    foreach ($broadcasts as $broadcast) {
        foreach ($broadcast['channels'] as $channel) {
            if (userCanJoinChannel($test, $user, $channel)) {
                $reaching[] = $broadcast['payload'];
                break;
            }
        }
    }

    return $reaching;
}

/**
 * Run $change as the DM (as a web request, like the explorer's PATCH would) and return what each
 * dispatched MapMarkerChanged event would broadcast: its channel names and its payload, both
 * serialised inside the DM's request, as the broadcaster does.
 *
 * @return array<int, array{channels: array<int, string>, payload: array<string, mixed>}>
 */
function dmChangesMarkers($test, callable $change, string $event = MarkerChanged::class): array
{
    dmOnlyAdmin();
    campaignRequest($test);
    Event::fake([MarkerChanged::class, MapMarkersResync::class]);
    $change();

    return collect(Event::dispatched($event))
        ->map(fn ($args) => $args[0])
        ->filter(fn ($event) => ! method_exists($event, 'broadcastWhen') || $event->broadcastWhen())
        ->map(fn ($event) => [
            'channels' => collect($event->broadcastOn())->map(fn ($c) => (string) $c->name)->all(),
            'payload' => json_decode(json_encode($event->broadcastWith()), true),
        ])
        ->values()
        ->all();
}

/**
 * A real-world map with a marker players can see, one only the DM can see, and one linked to a
 * character that the player role is explicitly denied (not private, just ACL-denied).
 *
 * @return array<string, mixed>
 */
function markerBroadcastFixture(): array
{
    $map = Map::factory()->create(['campaign_id' => 1, 'name' => 'Silver Harbor', 'is_real' => true]);
    $marker = fn (array $attributes) => MapMarker::factory()->create($attributes + [
        'map_id' => $map->id,
        'visibility_id' => Visibility::All,
        'created_by' => 1,
        'latitude' => 12.5,
        'longitude' => 34.5,
    ]);

    $denied = Character::factory()->create(['campaign_id' => 1, 'name' => 'dmonly-denied-spy'])->entity;
    CampaignPermission::create([
        'campaign_role_id' => 3,
        'campaign_id' => 1,
        'entity_type_id' => $denied->type_id,
        'entity_id' => $denied->id,
        'action' => CampaignPermission::ACTION_READ,
        'access' => false,
    ]);
    $visibleEntity = Character::factory()->create(['campaign_id' => 1, 'name' => 'Harbor Master'])->entity;

    $hiddenGroup = MapGroup::factory()->create(['map_id' => $map->id, 'name' => 'dmonly-group', 'visibility_id' => Visibility::Admin]);

    return [
        'map' => $map,
        'denied' => $denied,
        'visibleEntity' => $visibleEntity,
        'public' => $marker(['name' => 'Lighthouse', 'entity_id' => $visibleEntity->id]),
        'admin' => $marker(['name' => 'dmonly-marker-admin', 'entry' => '<p>dmonly-admin-entry</p>', 'visibility_id' => Visibility::Admin]),
        'toDenied' => $marker(['name' => '', 'entry' => '<p>dmonly-denied-entry</p>', 'entity_id' => $denied->id]),
        'inHiddenGroup' => $marker(['name' => 'dmonly-marker-in-group', 'group_id' => $hiddenGroup->id]),
        'hiddenGroup' => $hiddenGroup,
    ];
}

function markerBroadcastPlayer(): User
{
    dmOnlyPlayer();

    return User::find(7201);
}

it('reproduces: never sends a player any detail or the id of a marker linked to an ACL-denied entity', function () {
    $this->asUser()->withCampaign();
    $fx = markerBroadcastFixture();
    $player = markerBroadcastPlayer();

    $events = dmChangesMarkers($this, fn () => $fx['toDenied']->update(['latitude' => 50.25, 'entry' => '<p>dmonly-denied-entry-2</p>']));
    $reaching = markerBroadcastsReaching($this, $player, $events);

    expect(json_encode($reaching))->not->toContain('dmonly-');
    expect(collect($reaching)->pluck('id')->all())->not->toContain($fx['toDenied']->id);
    expect(json_encode($reaching))->not->toContain('50.25');
});

it('reproduces: never tells a player that a DM-only marker changed, not even as a deletion', function () {
    $this->asUser()->withCampaign();
    $fx = markerBroadcastFixture();
    $player = markerBroadcastPlayer();

    foreach (['admin', 'inHiddenGroup'] as $key) {
        $events = dmChangesMarkers($this, fn () => $fx[$key]->update(['name' => 'dmonly-renamed']));
        expect(markerBroadcastsReaching($this, $player, $events))->toBe([], $key . ' update reached the player');

        $events = dmChangesMarkers($this, fn () => $fx[$key]->delete());
        expect(markerBroadcastsReaching($this, $player, $events))->toBe([], $key . ' delete reached the player');
    }

    $events = dmChangesMarkers($this, fn () => MapMarker::factory()->create([
        'map_id' => $fx['map']->id, 'name' => 'dmonly-new', 'visibility_id' => Visibility::Admin, 'created_by' => 1,
    ]));
    expect(markerBroadcastsReaching($this, $player, $events))->toBe([]);
});

it('reproduces: sends an authorized player only the marker id and action, never marker details', function () {
    $this->asUser()->withCampaign();
    $fx = markerBroadcastFixture();
    $player = markerBroadcastPlayer();

    $events = dmChangesMarkers($this, fn () => $fx['public']->update(['name' => 'Lighthouse (lit)']));
    $reaching = markerBroadcastsReaching($this, $player, $events);

    expect($reaching)->toHaveCount(1);
    expect(array_keys($reaching[0]))->toEqualCanonicalizing(['action', 'id', 'map_id']);
    expect($reaching[0]['id'])->toBe($fx['public']->id);
    expect($reaching[0]['action'])->toBe('updated');
});

/**
 * The ids of the users that the resyncs dispatched by $change reach. A resync carries only the
 * campaign id.
 *
 * @return array<int, int>
 */
function dmResyncs($test, callable $change): array
{
    $events = dmChangesMarkers($test, $change, MapMarkersResync::class);
    foreach ($events as $event) {
        expect(array_keys($event['payload']))->toBe(['campaign_id']);
    }

    return collect($events)
        ->flatMap(fn ($event) => $event['channels'])
        ->map(fn ($channel) => (int) preg_replace('/^private-users\.(\d+)\.maps$/', '$1', $channel))
        ->unique()
        ->sort()
        ->values()
        ->all();
}

/**
 * GET one marker from the explorer API as $user, in a fresh request.
 */
function fetchMarkerAs($test, User $user, Map $map, int $markerId)
{
    Laravel\Passport\Passport::actingAs($user, ['*']);
    $test->asWebRequest();
    // Each request has its own connection in production, so the permission service's temporary
    // table never outlives it; the test's shared in-memory connection keeps it.
    Illuminate\Support\Facades\DB::statement('DROP TABLE IF EXISTS temp.tmp_permissions');

    return $test->getJson(route('entities.map-api.marker', [1, $map->entity, $markerId]));
}

it('sends the DM every marker change, as ids only, on the DM\'s own channel', function () {
    $this->asUser()->withCampaign();
    $fx = markerBroadcastFixture();
    markerBroadcastPlayer();
    $dm = User::find(1);

    foreach (['public', 'admin', 'toDenied', 'inHiddenGroup'] as $key) {
        $events = dmChangesMarkers($this, fn () => $fx[$key]->update(['name' => 'dmonly-renamed', 'latitude' => 77.5]));
        $reaching = markerBroadcastsReaching($this, $dm, $events);

        expect($reaching)->toHaveCount(1);
        expect($reaching[0])->toBe(['action' => 'updated', 'id' => $fx[$key]->id, 'map_id' => $fx['map']->id]);
        expect(json_encode($events))->not->toContain('dmonly-')->not->toContain('77.5');
        foreach ($events as $event) {
            foreach ($event['channels'] as $channel) {
                expect($channel)->toMatch('/^private-users\.\d+\.maps$/');
            }
        }
    }
});

it('sends nothing to a user outside the campaign, and nobody may join another user\'s channel', function () {
    $this->asUser()->withCampaign();
    $fx = markerBroadcastFixture();
    $player = markerBroadcastPlayer();
    $outsider = User::factory()->create(['id' => 7301]);

    $events = dmChangesMarkers($this, fn () => $fx['public']->update(['name' => 'Lighthouse (lit)']));
    expect(markerBroadcastsReaching($this, $outsider, $events))->toBe([]);

    expect(userCanJoinChannel($this, $player, 'private-users.1.maps'))->toBeFalse();
    expect(userCanJoinChannel($this, $outsider, 'private-users.7201.maps'))->toBeFalse();
    expect(userCanJoinChannel($this, $player, 'private-users.7201.maps'))->toBeTrue();
});

it('tells a player a marker is gone when it is hidden from them, and new when it is shown again', function () {
    $this->asUser()->withCampaign();
    $fx = markerBroadcastFixture();
    $player = markerBroadcastPlayer();

    $events = dmChangesMarkers($this, fn () => $fx['public']->update(['visibility_id' => Visibility::Admin]));
    expect(markerBroadcastsReaching($this, $player, $events))
        ->toBe([['action' => 'deleted', 'id' => $fx['public']->id, 'map_id' => $fx['map']->id]]);
    fetchMarkerAs($this, $player, $fx['map'], $fx['public']->id)->assertNotFound();

    $events = dmChangesMarkers($this, fn () => $fx['public']->update(['visibility_id' => Visibility::All]));
    expect(markerBroadcastsReaching($this, $player, $events))
        ->toBe([['action' => 'created', 'id' => $fx['public']->id, 'map_id' => $fx['map']->id]]);
    fetchMarkerAs($this, $player, $fx['map'], $fx['public']->id)->assertOk();
});

it('follows a group\'s visibility for the markers in it', function () {
    $this->asUser()->withCampaign();
    $fx = markerBroadcastFixture();
    $player = markerBroadcastPlayer();

    $events = dmChangesMarkers($this, fn () => $fx['hiddenGroup']->update(['visibility_id' => Visibility::All]));
    expect(markerBroadcastsReaching($this, $player, $events))
        ->toBe([['action' => 'created', 'id' => $fx['inHiddenGroup']->id, 'map_id' => $fx['map']->id]]);

    $events = dmChangesMarkers($this, fn () => $fx['hiddenGroup']->update(['visibility_id' => Visibility::Admin]));
    expect(markerBroadcastsReaching($this, $player, $events))
        ->toBe([['action' => 'deleted', 'id' => $fx['inHiddenGroup']->id, 'map_id' => $fx['map']->id]]);
});

it('resyncs the affected members when a permission is revoked or granted, and the API follows', function () {
    $this->asUser()->withCampaign();
    $fx = markerBroadcastFixture();
    $player = markerBroadcastPlayer();
    fetchMarkerAs($this, $player, $fx['map'], $fx['public']->id)->assertOk();

    // Revoke: the player role loses sight of the entity the public marker points at.
    $permission = null;
    $resynced = dmResyncs($this, function () use ($fx, &$permission) {
        $permission = CampaignPermission::create([
            'campaign_role_id' => 3,
            'campaign_id' => 1,
            'entity_type_id' => $fx['visibleEntity']->type_id,
            'entity_id' => $fx['visibleEntity']->id,
            'action' => CampaignPermission::ACTION_READ,
            'access' => false,
        ]);
    });
    expect($resynced)->toBe([7201]);
    fetchMarkerAs($this, $player, $fx['map'], $fx['public']->id)->assertNotFound();

    // From then on, changes to that marker no longer reach the player.
    $events = dmChangesMarkers($this, fn () => $fx['public']->update(['name' => 'Lighthouse (dark)']));
    expect(markerBroadcastsReaching($this, $player, $events))->toBe([]);

    // Grant it back.
    expect(dmResyncs($this, fn () => $permission->delete()))->toBe([7201]);
    fetchMarkerAs($this, $player, $fx['map'], $fx['public']->id)->assertOk();

    // A user-level permission resyncs only that user.
    expect(dmResyncs($this, fn () => CampaignPermission::create([
        'user_id' => 7201,
        'campaign_id' => 1,
        'entity_type_id' => $fx['denied']->type_id,
        'entity_id' => $fx['denied']->id,
        'action' => CampaignPermission::ACTION_READ,
        'access' => true,
    ])))->toBe([7201]);

    // Edit permissions don't change what anyone sees on a map.
    expect(dmResyncs($this, fn () => CampaignPermission::create([
        'campaign_role_id' => 3,
        'campaign_id' => 1,
        'entity_type_id' => $fx['denied']->type_id,
        'entity_id' => $fx['denied']->id,
        'action' => CampaignPermission::ACTION_EDIT,
        'access' => true,
    ])))->toBe([]);
});

it('resyncs a member whose role changes, and the campaign when an entity\'s privacy changes', function () {
    $this->asUser()->withCampaign();
    $fx = markerBroadcastFixture();
    $player = markerBroadcastPlayer();

    expect(dmResyncs($this, fn () => CampaignRoleUser::where('user_id', 7201)->first()->delete()))->toBe([7201]);
    expect(dmResyncs($this, fn () => CampaignRoleUser::create(['campaign_role_id' => 3, 'user_id' => 7201])))->toBe([7201]);

    expect(dmResyncs($this, fn () => $fx['visibleEntity']->update(['is_private' => true])))->toContain(7201);
    fetchMarkerAs($this, $player, $fx['map'], $fx['public']->id)->assertNotFound();
});

it('serves a player one marker only when the explorer would show it, and 404s otherwise', function () {
    $this->asUser()->withCampaign();
    $fx = markerBroadcastFixture();
    $player = markerBroadcastPlayer();

    fetchMarkerAs($this, $player, $fx['map'], $fx['public']->id)
        ->assertOk()
        ->assertJsonPath('id', $fx['public']->id);

    // Compare the bodies as production serves them, without the debug trace.
    config(['app.debug' => false]);
    $missing = MapMarker::query()->max('id') + 100;
    $bodies = [];
    foreach (['admin', 'toDenied', 'inHiddenGroup'] as $key) {
        $response = fetchMarkerAs($this, $player, $fx['map'], $fx[$key]->id)->assertNotFound();
        expectNoDmOnlyText($response, $key);
        $bodies[] = $response->getContent();
    }
    $bodies[] = fetchMarkerAs($this, $player, $fx['map'], $missing)->assertNotFound()->getContent();
    // A hidden marker answers exactly like one that doesn't exist.
    expect(array_unique($bodies))->toHaveCount(1);

    // A marker on another map isn't served under this one.
    $otherMap = Map::factory()->create(['campaign_id' => 1, 'name' => 'Elsewhere']);
    $elsewhere = MapMarker::factory()->create(['map_id' => $otherMap->id, 'visibility_id' => Visibility::All, 'created_by' => 1]);
    fetchMarkerAs($this, $player, $fx['map'], $elsewhere->id)->assertNotFound();

    // The DM gets the DM-only ones.
    foreach (['admin', 'toDenied', 'inHiddenGroup'] as $key) {
        fetchMarkerAs($this, User::find(1), $fx['map'], $fx[$key]->id)->assertOk();
    }
});

it('tells only the old map\'s audience a marker left, and the new map\'s that it arrived', function () {
    $this->asUser()->withCampaign();
    $fx = markerBroadcastFixture();
    $player = markerBroadcastPlayer();
    $otherMap = Map::factory()->create(['campaign_id' => 1, 'name' => 'Elsewhere']);

    $events = dmChangesMarkers($this, fn () => $fx['public']->update(['map_id' => $otherMap->id]));
    $reaching = collect(markerBroadcastsReaching($this, $player, $events))->sortBy('map_id')->values()->all();
    expect($reaching)->toEqualCanonicalizing([
        ['action' => 'deleted', 'id' => $fx['public']->id, 'map_id' => $fx['map']->id],
        ['action' => 'created', 'id' => $fx['public']->id, 'map_id' => $otherMap->id],
    ]);
});

it('keeps hidden markers out of a player\'s initial map load', function () {
    $this->asUser()->withCampaign();
    $fx = markerBroadcastFixture();
    $player = markerBroadcastPlayer();
    config(['broadcasting.connections.reverb.key' => 'test-key']);

    Laravel\Passport\Passport::actingAs($player, ['*']);
    $this->asWebRequest();
    $response = $this->getJson(route('entities.map-api', [1, $fx['map']->entity]))->assertOk();
    expectNoDmOnlyText($response, 'initial map load');
    expect(collect($response->json('pins'))->pluck('id')->all())->toBe([$fx['public']->id]);
    expect($response->json('interactive.user_channel'))->toBe('users.7201.maps');
    expect($response->json('interactive.admin_channel'))->toBeNull();

    dmOnlyAdmin();
    $this->asWebRequest();
    $ids = collect($this->getJson(route('entities.map-api', [1, $fx['map']->entity]))->json('pins'))->pluck('id')->sort()->values()->all();
    expect($ids)->toBe(collect(['public', 'admin', 'toDenied', 'inHiddenGroup'])->map(fn ($k) => $fx[$k]->id)->sort()->values()->all());
});

it('keeps editors who are not admins off the admin map channel', function () {
    $this->asUser()->withCampaign();
    $fx = markerBroadcastFixture();
    $player = markerBroadcastPlayer();
    $map = $fx['map'];
    CampaignPermission::create([
        'campaign_role_id' => 3,
        'campaign_id' => 1,
        'entity_type_id' => $map->entity->type_id,
        'entity_id' => $map->entity->id,
        'action' => CampaignPermission::ACTION_EDIT,
        'access' => true,
    ]);
    campaignRequest($this);
    expect($player->can('update', $map->entity))->toBeTrue();

    expect(userCanJoinChannel($this, $player, 'private-map.' . $map->id . '.admin'))->toBeFalse();
    expect(userCanJoinChannel($this, $player, 'presence-map.' . $map->id))->toBeTrue();
    expect(userCanJoinChannel($this, User::find(1), 'private-map.' . $map->id . '.admin'))->toBeTrue();

    config(['broadcasting.connections.reverb.key' => 'test-key']);
    dmOnlyAdmin();
    $this->asWebRequest();
    $this->getJson(route('entities.map-api', [1, $map->entity]))
        ->assertJsonPath('interactive.admin_channel', 'map.' . $map->id . '.admin');
});

it('sends groups to each map channel only as its audience may see them', function () {
    $this->asUser()->withCampaign();
    $fx = markerBroadcastFixture();
    markerBroadcastPlayer();
    $map = $fx['map'];
    $memberGroup = MapGroup::factory()->create(['map_id' => $map->id, 'name' => 'Harbor District', 'visibility_id' => Visibility::Member]);
    $playersOwn = MapGroup::factory()->create(['map_id' => $map->id, 'name' => 'dmonly-player-self', 'visibility_id' => Visibility::Self, 'created_by' => 7201]);

    $groups = fn (bool $restricted) => collect(new ContentsChanged($map, $restricted)->broadcastWith()['groups'])
        ->map(fn ($group) => $group->resource->id)->sort()->values()->all();

    expect($groups(false))->toBe([$memberGroup->id]);
    // Admins see the Admin group, but not another user's Self one.
    expect($groups(true))->toBe(collect([$fx['hiddenGroup']->id, $memberGroup->id])->sort()->values()->all());
    expect($groups(true))->not->toContain($playersOwn->id);
});
