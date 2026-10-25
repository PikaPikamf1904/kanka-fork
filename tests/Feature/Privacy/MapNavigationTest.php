<?php

/*
 * The map explorer lists the parent maps (breadcrumbs), the child maps and the levels (sibling
 * maps, used for floors). A player must never learn about a map they can't see from those lists.
 */

use App\Models\Campaign;
use App\Models\Map;

require_once __DIR__ . '/support.php';

/**
 * Region > Town > (Ground floor, Upper floor, dmonly-cellar), plus a hidden map above Region.
 *
 * @return array<string, Map>
 */
function mapTreeFixture(): array
{
    $make = function (string $name, ?Map $parent = null, bool $private = false): Map {
        $map = Map::factory()->create(['campaign_id' => 1, 'name' => $name]);
        $map->entity->update(['parent_id' => $parent?->entity->id, 'is_private' => $private]);

        return $map;
    };

    $world = $make('dmonly-world', null, true);
    $region = $make('Region', $world);
    $town = $make('Town', $region);
    $ground = $make('Ground floor', $town);
    $upper = $make('Upper floor', $town);
    $cellar = $make('dmonly-cellar', $town, true);
    $secret = $make('dmonly-secret-room', $ground, true);

    return compact('world', 'region', 'town', 'ground', 'upper', 'cellar', 'secret');
}

it('gives the explorer its breadcrumbs, child maps and levels', function () {
    $this->asUser()->withCampaign();
    $maps = mapTreeFixture();

    dmOnlyAdmin();
    $this->asWebRequest();
    $nav = $this->getJson(route('entities.map-api', [1, $maps['ground']->entity]))->assertOk()->json('navigation');

    expect(collect($nav['ancestors'])->pluck('name')->all())->toBe(['dmonly-world', 'Region', 'Town']);
    expect(collect($nav['children'])->pluck('name')->all())->toBe(['dmonly-secret-room']);
    expect(collect($nav['levels'])->pluck('name')->all())->toBe(['dmonly-cellar', 'Ground floor', 'Upper floor']);
    expect(collect($nav['levels'])->firstWhere('current', true)['name'])->toBe('Ground floor');
    expect($nav['ancestors'][2]['url'])->toBe(route('entities.map', [Campaign::find(1), $maps['town']->entity]));
});

it('keeps hidden maps out of a player\'s breadcrumbs, child maps and levels', function () {
    $this->asUser()->withCampaign();
    $maps = mapTreeFixture();

    dmOnlyPlayer();
    $this->asWebRequest();
    $response = $this->getJson(route('entities.map-api', [1, $maps['ground']->entity]))->assertOk();
    expectNoDmOnlyText($response, 'map navigation');

    $nav = $response->json('navigation');
    // The trail stops at the hidden world map instead of revealing that something is above it.
    expect(collect($nav['ancestors'])->pluck('name')->all())->toBe(['Region', 'Town']);
    expect($nav['children'])->toBe([]);
    expect(collect($nav['levels'])->pluck('name')->all())->toBe(['Ground floor', 'Upper floor']);

    // The hidden map itself stays closed.
    $this->get(route('entities.map-api', [1, $maps['cellar']->entity]))->assertNotFound();
});

it('stops the breadcrumbs at the first parent the player cannot see', function () {
    $this->asUser()->withCampaign();
    $maps = mapTreeFixture();
    // Hide the middle of the chain: Region stays visible, but the player can't reach it from Town.
    $maps['town']->entity->update(['is_private' => true]);

    dmOnlyPlayer();
    $this->asWebRequest();
    $response = $this->getJson(route('entities.map-api', [1, $maps['upper']->entity]))->assertOk();

    expect($response->json('navigation.ancestors'))->toBe([]);
    expect($response->json('navigation.levels'))->toBe([]);
    expect((string) $response->getContent())->not->toContain('"Town"')->not->toContain('"Region"');
});

it('shows no levels for a map without siblings', function () {
    $this->asUser()->withCampaign();
    $map = Map::factory()->create(['campaign_id' => 1]);

    $nav = $this->getJson(route('entities.map-api', [1, $map->entity]))->assertOk()->json('navigation');
    expect($nav)->toBe(['ancestors' => [], 'children' => [], 'levels' => []]);
});
