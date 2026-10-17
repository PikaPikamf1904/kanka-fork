<?php

/*
 * DM-only content must never reach a player, through any page or JSON endpoint. These tests
 * make real HTTP requests with the app in web mode (asWebRequest), because some of the scopes
 * that hide this content are switched off in the console. Each test also checks that a campaign
 * admin does see the content, so a broken fixture cannot make a test pass.
 *
 * All names are synthetic markers ("dmonly-...") so a leak shows up in the response text.
 */

use App\Enums\EntityAssetType;
use App\Enums\Visibility;
use App\Facades\CampaignLocalization;
use App\Models\Attribute;
use App\Models\Campaign;
use App\Models\CampaignRoleUser;
use App\Models\CampaignUser;
use App\Models\Character;
use App\Models\Entity;
use App\Models\EntityAsset;
use App\Models\Map;
use App\Models\MapGroup;
use App\Models\MapLayer;
use App\Models\MapMarker;
use App\Models\Post;
use App\Models\Relation;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Laravel\Passport\Passport;

/**
 * A campaign with one public character ("Harbor Watch") and DM-only content around it.
 *
 * @return array<string, mixed>
 */
function dmOnlyFixture(): array
{
    $public = Character::factory()->create([
        'campaign_id' => 1,
        'name' => 'Harbor Watch',
    ])->entity;

    $hidden = Character::factory()->create([
        'campaign_id' => 1,
        'name' => 'dmonly-hidden-villain',
        'is_private' => true,
    ])->entity;
    $hidden->update(['is_private' => true]);

    $ally = Character::factory()->create(['campaign_id' => 1, 'name' => 'Lighthouse Keeper'])->entity;

    $public->update(['entry' => '<p>The watch reports to [character:' . $hidden->id . '] and [character:' . $ally->id . '].</p>']);

    Post::factory()->create([
        'entity_id' => $public->id,
        'name' => 'Player-visible note',
        'entry' => '<p>Anyone in the campaign can read this.</p>',
        'visibility_id' => Visibility::All,
    ]);
    Post::factory()->create([
        'entity_id' => $public->id,
        'name' => 'dmonly-post-title',
        'entry' => '<p>dmonly-post-entry</p>',
        'visibility_id' => Visibility::Admin,
    ]);

    Attribute::factory()->create([
        'entity_id' => $public->id,
        'name' => 'Rank',
        'value' => 'Sergeant',
        'is_private' => false,
    ]);
    Attribute::factory()->create([
        'entity_id' => $public->id,
        'name' => 'dmonly-attribute-name',
        'value' => 'dmonly-attribute-value',
        'is_private' => true,
    ]);

    Relation::factory()->create([
        'campaign_id' => 1,
        'owner_id' => $public->id,
        'target_id' => $ally->id,
        'relation' => 'dmonly-secret-relation',
        'visibility_id' => Visibility::Admin,
    ]);
    Relation::factory()->create([
        'campaign_id' => 1,
        'owner_id' => $public->id,
        'target_id' => $hidden->id,
        'relation' => 'dmonly-relation-to-hidden',
        'visibility_id' => Visibility::All,
    ]);

    EntityAsset::factory()->create([
        'entity_id' => $public->id,
        'type_id' => EntityAssetType::alias,
        'name' => 'Harbor Patrol',
        'visibility_id' => Visibility::All,
    ]);
    EntityAsset::factory()->create([
        'entity_id' => $public->id,
        'type_id' => EntityAssetType::alias,
        'name' => 'dmonly-alias',
        'visibility_id' => Visibility::Admin,
    ]);
    $link = EntityAsset::factory()->create([
        'entity_id' => $public->id,
        'type_id' => EntityAssetType::link,
        'name' => 'dmonly-link',
        'metadata' => ['url' => 'https://example.com/dmonly-link-target'],
        'visibility_id' => Visibility::Admin,
    ]);
    EntityAsset::factory()->create([
        'entity_id' => $public->id,
        'type_id' => EntityAssetType::file,
        'name' => 'dmonly-file',
        'metadata' => ['path' => 'entities/files/dmonly-file.pdf', 'type' => 'application/pdf', 'size' => 10],
        'visibility_id' => Visibility::Admin,
    ]);

    return compact('public', 'hidden', 'ally', 'link');
}

function dmOnlyPlayer(): void
{
    $player = User::factory()->create(['id' => 7201]);
    CampaignUser::create(['campaign_id' => 1, 'user_id' => $player->id]);
    CampaignRoleUser::create(['campaign_role_id' => 3, 'user_id' => $player->id]);
    Passport::actingAs($player, ['*']);
}

function dmOnlyAdmin(): void
{
    Passport::actingAs(User::find(1), ['*']);
}

function expectNoDmOnlyText($response, string $where = ''): void
{
    $content = (string) $response->getContent();
    $at = mb_strpos($content, 'dmonly-');
    $context = $at === false ? '' : mb_substr($content, max(0, $at - 300), 400);
    expect($at)->toBeFalse(mb_trim($where . ' leaked DM-only text: ' . $context));
}

it('hides DM-only content from the entity page', function () {
    $this->asUser()->withCampaign();
    ['public' => $public] = dmOnlyFixture();

    dmOnlyPlayer();
    $this->asWebRequest();
    $response = $this->get(route('entities.show', [1, $public]))->assertOk();
    expect((string) $response->getContent())->toContain('Harbor Watch')
        ->toContain('Player-visible note')
        ->toContain('Lighthouse Keeper');
    expectNoDmOnlyText($response);

    dmOnlyAdmin();
    $this->asWebRequest();
    expect((string) $this->get(route('entities.show', [1, $public]))->assertOk()->getContent())
        ->toContain('dmonly-hidden-villain')
        ->toContain('dmonly-post-title')
        ->toContain('dmonly-post-entry');
});

it('refuses a hidden entity\'s own page and tooltip to a player', function () {
    $this->asUser()->withCampaign();
    ['hidden' => $hidden] = dmOnlyFixture();

    dmOnlyPlayer();
    $this->asWebRequest();
    foreach (['entities.show', 'entities.tooltip'] as $route) {
        $response = $this->get(route($route, [1, $hidden]));
        expect($response->status())->toBeIn([403, 404]);
        expectNoDmOnlyText($response);
    }

    dmOnlyAdmin();
    $this->asWebRequest();
    $this->get(route('entities.show', [1, $hidden]))->assertOk();
});

it('keeps hidden entities out of the character list', function () {
    $this->asUser()->withCampaign();
    dmOnlyFixture();

    // The list page is a shell; its rows come from the index API. Entity type 1 is characters.
    dmOnlyPlayer();
    $this->asWebRequest();
    $this->get(route('characters.index', [1]))->assertRedirect(route('entities.index', [Campaign::find(1), 1]));
    $this->get(route('entities.index', [1, 1]))->assertOk();
    $response = $this->getJson(route('entities.index-api', [1, 1]))->assertOk();
    expect((string) $response->getContent())->toContain('Harbor Watch');
    expectNoDmOnlyText($response);

    dmOnlyAdmin();
    $this->asWebRequest();
    expect((string) $this->getJson(route('entities.index-api', [1, 1]))->getContent())->toContain('dmonly-hidden-villain');
});

it('keeps DM-only content out of search results', function (string $route, array $query) {
    if ($route !== 'search-list' && DB::connection()->getDriverName() === 'sqlite') {
        $this->markTestSkipped('This search uses MariaDB-only SQL (RLIKE). Run it with deploy/dev/run.sh pest-mariadb.');
    }
    $this->asUser()->withCampaign();
    dmOnlyFixture();

    dmOnlyPlayer();
    $this->asWebRequest();
    $response = $this->get(route($route, [1] + $query))->assertOk();
    expectNoDmOnlyText($response);
    // Nor may a DM-only alias lead a player to the entity it belongs to.
    $response = $this->get(route($route, [1] + ['q' => 'dmonly-alias'] + $query))->assertOk();
    expect((string) $response->getContent())->not->toContain('Harbor Watch');

    dmOnlyAdmin();
    $this->asWebRequest();
    expect((string) $this->get(route($route, [1] + $query))->getContent())->toContain('dmonly-hidden-villain');
    if ($route !== 'search-list') {
        expect((string) $this->get(route($route, [1] + ['q' => 'dmonly-alias'] + $query))->getContent())
            ->toContain('Harbor Watch');
    }
})->with([
    'live search' => ['search.live', ['q' => 'dmonly']],
    'live search v2' => ['search.live', ['q' => 'dmonly', 'v2' => 'true']],
    'mention search' => ['search.mention', ['q' => 'dmonly']],
    'character search' => ['search-list', ['entity_type' => 1, 'q' => 'dmonly']],
]);

it('keeps DM-only posts and attributes out of the editor mention lookups', function () {
    if (DB::connection()->getDriverName() === 'sqlite') {
        $this->markTestSkipped('This search uses MariaDB-only SQL (RLIKE). Run it with deploy/dev/run.sh pest-mariadb.');
    }
    $this->asUser()->withCampaign();
    ['public' => $public, 'hidden' => $hidden] = dmOnlyFixture();
    $load = ['posts' => Post::pluck('id')->all(), 'entities' => [$public->id, $hidden->id]];

    dmOnlyPlayer();
    $this->asWebRequest();
    foreach ([$public, $hidden] as $entity) {
        $response = $this->get(route('search.mention', [1, 'q' => 'dmonly', 'entity' => $entity->id]))->assertOk();
        expectNoDmOnlyText($response, 'search in ' . $entity->name);
    }
    // Web mode switches CSRF protection back on, so send a token like the editor does.
    $response = $this->withSession(['_token' => 'csrf-test-token'])->withHeader('X-CSRF-TOKEN', 'csrf-test-token')
        ->postJson(route('search.mention.load', [1]), $load)->assertOk();
    expect((string) $response->getContent())->toContain('Player-visible note');
    expectNoDmOnlyText($response, 'mention labels');

    dmOnlyAdmin();
    $this->asWebRequest();
    expect((string) $this->withSession(['_token' => 'csrf-test-token'])->withHeader('X-CSRF-TOKEN', 'csrf-test-token')
        ->postJson(route('search.mention.load', [1]), $load)->getContent())
        ->toContain('dmonly-post-title');
    expect((string) $this->get(route('search.mention', [1, 'q' => 'dmonly', 'entity' => $public->id]))->getContent())
        ->toContain('dmonly-post-title')
        ->toContain('dmonly-attribute-name');
});

it('hides DM-only files, links and aliases', function () {
    $this->asUser()->withCampaign();
    ['public' => $public, 'link' => $link] = dmOnlyFixture();

    dmOnlyPlayer();
    $this->asWebRequest();
    $response = $this->get(route('entities.entity_assets.index', [1, $public]))->assertOk();
    expectNoDmOnlyText($response);
    $response = $this->getJson('/api/1.0/campaigns/1/entities/' . $public->id . '/entity_assets')->assertOk();
    expect((string) $response->getContent())->toContain('Harbor Patrol')->not->toContain('dmonly-');
    $response = $this->get(route('entities.entity_assets.go', [1, $public, $link]));
    expect($response->status())->toBeIn([403, 404]);
    expect((string) $response->headers->get('Location'))->not->toContain('dmonly');

    dmOnlyAdmin();
    $this->asWebRequest();
    expect((string) $this->get(route('entities.entity_assets.index', [1, $public]))->getContent())
        ->toContain('dmonly-link')
        ->toContain('dmonly-file');
});

it('hides private attributes from the attributes tab', function () {
    $this->asUser()->withCampaign();
    ['public' => $public] = dmOnlyFixture();

    dmOnlyPlayer();
    $this->asWebRequest();
    $response = $this->get(route('entities.attributes', [1, $public]))->assertOk();
    expect((string) $response->getContent())->toContain('Sergeant');
    expectNoDmOnlyText($response);

    dmOnlyAdmin();
    $this->asWebRequest();
    expect((string) $this->get(route('entities.attributes', [1, $public]))->getContent())
        ->toContain('dmonly-attribute-value');
});

it('hides DM-only relations and relations to hidden entities', function () {
    $this->asUser()->withCampaign();
    ['public' => $public] = dmOnlyFixture();

    dmOnlyPlayer();
    $this->asWebRequest();
    foreach (['entities.relations_table', 'entities.relations_map'] as $route) {
        $response = $this->get(route($route, [1, $public]));
        expect($response->status())->toBeIn([200, 403]);
        expectNoDmOnlyText($response);
    }

    dmOnlyAdmin();
    $this->asWebRequest();
    expect((string) $this->get(route('entities.relations_table', [1, $public]))->getContent())
        ->toContain('dmonly-secret-relation')
        ->toContain('dmonly-relation-to-hidden');
});

it('keeps DM-only content out of the JSON API', function () {
    $this->asUser()->withCampaign();
    ['public' => $public, 'hidden' => $hidden] = dmOnlyFixture();

    $urls = [
        '/api/1.0/campaigns/1/characters',
        '/api/1.0/campaigns/1/entities',
        '/api/1.0/campaigns/1/entities/' . $public->id . '/posts',
        '/api/1.0/campaigns/1/entities/' . $public->id . '/attributes',
        '/api/1.0/campaigns/1/entities/' . $public->id . '/relations',
        '/api/1.0/campaigns/1/relations',
        '/api/1.0/campaigns/1/search/dmonly',
    ];

    dmOnlyPlayer();
    $this->asWebRequest();
    foreach ($urls as $url) {
        $response = $this->getJson($url);
        expect($response->status())->toBeIn([200, 403, 404], $url);
        expect((string) $response->getContent())->not->toContain('dmonly-', $url);
    }
    $response = $this->getJson('/api/1.0/campaigns/1/entities/' . $hidden->id);
    expect($response->status())->toBeIn([403, 404]);
    expect((string) $response->getContent())->not->toContain('dmonly-');

    dmOnlyAdmin();
    $this->asWebRequest();
    expect((string) $this->getJson('/api/1.0/campaigns/1/entities/' . $public->id . '/posts')->getContent())
        ->toContain('dmonly-post-title');
});

it('keeps DM-only markers, layers and groups out of the map API', function () {
    $this->asUser()->withCampaign();
    $map = Map::factory()->create(['campaign_id' => 1, 'name' => 'Harbor map']);
    MapMarker::factory()->create(['map_id' => $map->id, 'name' => 'Public pier', 'visibility_id' => Visibility::All]);
    MapMarker::factory()->create(['map_id' => $map->id, 'name' => 'dmonly-marker', 'visibility_id' => Visibility::Admin]);
    $group = MapGroup::factory()->create(['map_id' => $map->id, 'name' => 'dmonly-group', 'visibility_id' => Visibility::Admin]);
    MapMarker::factory()->create(['map_id' => $map->id, 'name' => 'dmonly-marker-in-group', 'visibility_id' => Visibility::All, 'group_id' => $group->id]);
    // Layers without an image are never sent, so give this one an image path.
    MapLayer::factory()->create(['map_id' => $map->id, 'name' => 'dmonly-layer', 'visibility_id' => Visibility::Admin, 'image_path' => 'maps/layer.png']);
    $hidden = Character::factory()->create(['campaign_id' => 1, 'name' => 'dmonly-hidden-villain'])->entity;
    $hidden->update(['is_private' => true]);
    MapMarker::factory()->create(['map_id' => $map->id, 'name' => 'dmonly-marker-for-hidden', 'visibility_id' => Visibility::All, 'entity_id' => $hidden->id]);

    dmOnlyPlayer();
    $this->asWebRequest();
    $response = $this->get(route('entities.map-api', [1, $map->entity]))->assertOk();
    expect((string) $response->getContent())->toContain('Public pier');
    expectNoDmOnlyText($response);

    dmOnlyAdmin();
    $this->asWebRequest();
    expect((string) $this->get(route('entities.map-api', [1, $map->entity]))->getContent())
        ->toContain('dmonly-marker')
        ->toContain('dmonly-layer');
});

it('needs web mode for the visibility scopes (why these tests call asWebRequest)', function () {
    $this->asUser()->withCampaign();
    ['public' => $public] = dmOnlyFixture();
    dmOnlyPlayer();

    // Relations are hidden only by VisibilityIDScope, which is off in the console.
    expect(Relation::where('owner_id', $public->id)->count())->toBe(2);

    $this->asWebRequest();
    CampaignLocalization::forceCampaign(Campaign::find(1));
    expect(Relation::where('owner_id', $public->id)->count())->toBe(1);
});
