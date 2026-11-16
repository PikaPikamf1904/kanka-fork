<?php

/*
 * The map explorer sends every marker, layer and group in one payload, and each marker has its
 * own preview and details endpoints. A player must never get the DM-only ones from any of them:
 * markers or layers marked admin or self, markers in a DM-only group, or markers that point at
 * an entity the player can't see.
 */

use App\Enums\Visibility;
use App\Http\Middleware\VerifyCsrfToken;
use App\Models\Character;
use App\Models\Map;
use App\Models\MapGroup;
use App\Models\MapLayer;
use App\Models\MapMarker;

require_once __DIR__ . '/support.php';

/**
 * One public map with a public marker, layer and group, and DM-only counterparts of each.
 *
 * @return array<string, mixed>
 */
function mapPrivacyFixture(): array
{
    // A real-world map is explorable without an uploaded image.
    $map = Map::factory()->create(['campaign_id' => 1, 'name' => 'Silver Harbor', 'is_real' => true]);
    $marker = fn (array $attributes) => MapMarker::factory()->create($attributes + [
        'map_id' => $map->id,
        'visibility_id' => Visibility::All,
        'created_by' => 1,
    ]);

    MapLayer::factory()->create(['map_id' => $map->id, 'name' => 'Harbor streets', 'visibility_id' => Visibility::All, 'position' => 1, 'image_path' => 'layers/harbor.png', 'width' => 100, 'height' => 100]);
    MapLayer::factory()->create(['map_id' => $map->id, 'name' => 'dmonly-layer', 'visibility_id' => Visibility::Admin, 'position' => 2, 'image_path' => 'layers/dmonly.png', 'width' => 100, 'height' => 100]);

    $group = MapGroup::factory()->create(['map_id' => $map->id, 'name' => 'Docks', 'visibility_id' => Visibility::All]);
    $hiddenGroup = MapGroup::factory()->create(['map_id' => $map->id, 'name' => 'dmonly-group', 'visibility_id' => Visibility::Admin]);

    $hiddenEntity = Character::factory()->create(['campaign_id' => 1, 'name' => 'dmonly-smuggler', 'is_private' => true])->entity;
    $hiddenEntity->update(['is_private' => true]);

    $public = $marker(['name' => 'Lighthouse', 'group_id' => $group->id]);
    $admin = $marker(['name' => 'dmonly-marker-admin', 'visibility_id' => Visibility::Admin]);
    $self = $marker(['name' => 'dmonly-marker-self', 'visibility_id' => Visibility::Self]);
    $inGroup = $marker(['name' => 'dmonly-marker-in-group', 'group_id' => $hiddenGroup->id]);
    $toHidden = $marker(['name' => 'dmonly-marker-to-hidden', 'entity_id' => $hiddenEntity->id]);

    // A marker on a map the player can't open at all.
    $hiddenMap = Map::factory()->create(['campaign_id' => 1, 'name' => 'dmonly-hidden-map']);
    $hiddenMap->entity->update(['is_private' => true]);
    $otherMap = MapMarker::factory()->create(['map_id' => $hiddenMap->id, 'name' => 'dmonly-marker-other-map', 'visibility_id' => Visibility::All, 'created_by' => 1]);

    return compact('map', 'public', 'admin', 'self', 'inGroup', 'toHidden', 'otherMap');
}

it('gives the DM every marker, layer and group in the explorer', function () {
    $this->asUser()->withCampaign();
    $fx = mapPrivacyFixture();

    dmOnlyAdmin();
    $this->asWebRequest();
    $json = $this->getJson(route('entities.map-api', [1, $fx['map']->entity]))->assertOk()->json();

    expect(collect($json['pins'])->pluck('name')->all())->toContain('Lighthouse', 'dmonly-marker-admin', 'dmonly-marker-self', 'dmonly-marker-in-group', 'dmonly-marker-to-hidden');
    expect(collect($json['layers'])->pluck('name')->all())->toContain('Harbor streets', 'dmonly-layer');
    expect(collect($json['groups'])->pluck('name')->all())->toContain('Docks', 'dmonly-group');
});

it('keeps DM-only markers, layers and groups out of a player\'s explorer', function () {
    $this->asUser()->withCampaign();
    $fx = mapPrivacyFixture();

    dmOnlyPlayer();
    $this->asWebRequest();
    $response = $this->getJson(route('entities.map-api', [1, $fx['map']->entity]))->assertOk();
    expectNoDmOnlyText($response, 'map explorer payload');

    expect(collect($response->json('pins'))->pluck('name')->all())->toBe(['Lighthouse']);
    expect(collect($response->json('layers'))->pluck('name')->all())->toBe(['Harbor streets']);
    expect(collect($response->json('groups'))->pluck('name')->all())->toBe(['Docks']);

    expectNoDmOnlyText($this->get(route('entities.map', [1, $fx['map']->entity]))->assertOk(), 'map explorer page');
});

it('refuses a player the preview and details of a DM-only marker', function () {
    $this->asUser()->withCampaign();
    $fx = mapPrivacyFixture();

    dmOnlyPlayer();
    $this->asWebRequest();
    $this->getJson(route('entities.map-markers.preview', [1, $fx['map']->entity, $fx['public']]))->assertOk();

    foreach (['admin', 'self', 'inGroup', 'toHidden'] as $key) {
        $preview = $this->getJson(route('entities.map-markers.preview', [1, $fx['map']->entity, $fx[$key]]));
        expect($preview->status())->toBeIn([403, 404], "preview {$key}");
        expectNoDmOnlyText($preview, "preview {$key}");

        $details = $this->get(route('maps.markers.details', [1, $fx['map'], $fx[$key]]));
        expect($details->status())->toBeIn([403, 404], "details {$key}");
        expectNoDmOnlyText($details, "details {$key}");
    }

    // A marker from a hidden map, asked for through the public map's URLs.
    expect($this->getJson(route('entities.map-markers.preview', [1, $fx['map']->entity, $fx['otherMap']]))->status())->toBeIn([403, 404]);
    $details = $this->get(route('maps.markers.details', [1, $fx['map'], $fx['otherMap']]));
    expect($details->status())->toBeIn([403, 404], 'details from another map');
    expectNoDmOnlyText($details, 'details from another map');
});

it('keeps DM-only groups out of a player\'s group search', function () {
    $this->asUser()->withCampaign();
    $fx = mapPrivacyFixture();

    dmOnlyPlayer();
    $this->asWebRequest();
    $response = $this->getJson(route('map-groups-list', [1, $fx['map']]) . '?q=d');
    expect($response->status())->toBeIn([200, 403, 404]);
    expectNoDmOnlyText($response, 'group search');
});

it('keeps DM-only markers out of a player\'s API results', function () {
    $this->asUser()->withCampaign();
    $fx = mapPrivacyFixture();

    dmOnlyPlayer();
    $this->asWebRequest();
    $base = '/api/1.0/campaigns/1/maps/' . $fx['map']->id;

    $index = $this->getJson($base . '/map_markers')->assertOk();
    expectNoDmOnlyText($index, 'API marker list');
    expect(collect($index->json('data'))->pluck('name')->all())->toBe(['Lighthouse']);

    foreach (['admin', 'self', 'inGroup', 'toHidden', 'otherMap'] as $key) {
        $show = $this->getJson($base . '/map_markers/' . $fx[$key]->id);
        expect($show->status())->toBeIn([403, 404], "API marker {$key}");
        expectNoDmOnlyText($show, "API marker {$key}");
    }
});

it('keeps layers and groups of a hidden map out of a player\'s API results', function () {
    $this->asUser()->withCampaign();
    $fx = mapPrivacyFixture();
    $hiddenMap = Map::query()->where('name', 'dmonly-hidden-map')->first();
    $layer = MapLayer::factory()->create(['map_id' => $hiddenMap->id, 'name' => 'dmonly-other-layer', 'visibility_id' => Visibility::All]);
    $group = MapGroup::factory()->create(['map_id' => $hiddenMap->id, 'name' => 'dmonly-other-group', 'visibility_id' => Visibility::All]);

    dmOnlyPlayer();
    $this->asWebRequest();
    $base = '/api/1.0/campaigns/1/maps/' . $fx['map']->id;

    expectNoDmOnlyText($this->getJson($base . '/map_layers'), 'API layer list');
    expectNoDmOnlyText($this->getJson($base . '/map_groups'), 'API group list');
    foreach (["map_layers/{$layer->id}", "map_groups/{$group->id}"] as $path) {
        $show = $this->getJson($base . '/' . $path);
        expect($show->status())->toBeIn([403, 404], $path);
        expectNoDmOnlyText($show, $path);
    }
});

it('refuses to edit a layer or group through another map\'s address', function () {
    $this->asUser()->withCampaign();
    $fx = mapPrivacyFixture();
    $hiddenMap = Map::query()->where('name', 'dmonly-hidden-map')->first();
    $layer = MapLayer::factory()->create(['map_id' => $hiddenMap->id, 'name' => 'dmonly-other-layer', 'visibility_id' => Visibility::All]);
    $group = MapGroup::factory()->create(['map_id' => $hiddenMap->id, 'name' => 'dmonly-other-group', 'visibility_id' => Visibility::All]);

    dmOnlyAdmin();
    $this->asWebRequest();
    $this->get(route('maps.map_layers.edit', [1, $fx['map'], $layer]))->assertNotFound();
    $this->get(route('maps.map_groups.edit', [1, $fx['map'], $group]))->assertNotFound();
    $this->withoutMiddleware(VerifyCsrfToken::class);
    $this->delete(route('maps.map_layers.destroy', [1, $fx['map'], $layer]))->assertNotFound();
    $this->delete(route('maps.map_groups.destroy', [1, $fx['map'], $group]))->assertNotFound();
    expect(MapLayer::find($layer->id))->not->toBeNull();
    expect(MapGroup::find($group->id))->not->toBeNull();
});
