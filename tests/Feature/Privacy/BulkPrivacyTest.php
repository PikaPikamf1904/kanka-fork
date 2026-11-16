<?php

/*
 * Bulk actions on a map's markers, layers and groups (and a calendar's events, an organisation's
 * members, a timeline's eras) take a list of ids. Only the ones that belong to the record in the
 * URL may be deleted or changed: otherwise anyone who may edit one map could delete the markers
 * of a hidden map, or of another campaign.
 */

use App\Enums\Visibility;
use App\Http\Middleware\VerifyCsrfToken;
use App\Models\Map;
use App\Models\MapGroup;
use App\Models\MapLayer;
use App\Models\MapMarker;

require_once __DIR__ . '/support.php';

it('only bulk-deletes the markers, layers and groups of the map in the URL', function () {
    $this->asUser()->withCampaign();
    $map = Map::factory()->create(['campaign_id' => 1, 'name' => 'Silver Harbor', 'is_real' => true]);
    $hiddenMap = Map::factory()->create(['campaign_id' => 1, 'name' => 'dmonly-hidden-map']);
    $hiddenMap->entity->update(['is_private' => true]);

    $own = MapMarker::factory()->create(['map_id' => $map->id, 'name' => 'Lighthouse', 'visibility_id' => Visibility::All, 'created_by' => 1]);
    $other = MapMarker::factory()->create(['map_id' => $hiddenMap->id, 'name' => 'dmonly-marker', 'visibility_id' => Visibility::All, 'created_by' => 1]);
    $otherLayer = MapLayer::factory()->create(['map_id' => $hiddenMap->id, 'name' => 'dmonly-layer', 'visibility_id' => Visibility::All]);
    $otherGroup = MapGroup::factory()->create(['map_id' => $hiddenMap->id, 'name' => 'dmonly-group', 'visibility_id' => Visibility::All]);

    dmOnlyAdmin();
    $this->asWebRequest();
    $this->withoutMiddleware(VerifyCsrfToken::class);

    $this->post(route('maps.markers.bulk', [1, $map]), ['action' => 'delete', 'model' => [$own->id, $other->id]])->assertRedirect();
    $this->post(route('maps.layers.bulk', [1, $map]), ['action' => 'delete', 'model' => [$otherLayer->id]])->assertRedirect();
    $this->post(route('maps.groups.bulk', [1, $map]), ['action' => 'delete', 'model' => [$otherGroup->id]])->assertRedirect();

    expect(MapMarker::withoutGlobalScopes()->find($own->id))->toBeNull();
    expect(MapMarker::withoutGlobalScopes()->find($other->id))->not->toBeNull();
    expect(MapLayer::withoutGlobalScopes()->find($otherLayer->id))->not->toBeNull();
    expect(MapGroup::withoutGlobalScopes()->find($otherGroup->id))->not->toBeNull();
});

it('only bulk-patches the markers of the map in the URL', function () {
    $this->asUser()->withCampaign();
    $map = Map::factory()->create(['campaign_id' => 1, 'is_real' => true]);
    $hiddenMap = Map::factory()->create(['campaign_id' => 1]);
    $other = MapMarker::factory()->create(['map_id' => $hiddenMap->id, 'name' => 'dmonly-marker', 'visibility_id' => Visibility::Admin, 'created_by' => 1]);

    dmOnlyAdmin();
    $this->asWebRequest();
    $this->withoutMiddleware(VerifyCsrfToken::class);
    $this->post(route('maps.markers.bulk', [1, $map]), ['action' => 'patch', 'model' => [$other->id], 'visibility_id' => Visibility::All->value])->assertRedirect();

    expect(MapMarker::withoutGlobalScopes()->find($other->id)->visibility_id)->toBe(Visibility::Admin);
});
