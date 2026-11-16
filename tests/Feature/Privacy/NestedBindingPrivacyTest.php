<?php

/*
 * Nested routes bind each model by its own id. The controllers authorize the parent in the URL,
 * so the child must belong to it: otherwise a post, relation, attribute or inventory row of a
 * hidden entity (or a record of another campaign) could be read through any parent the viewer
 * can open.
 */

use App\Enums\Visibility;
use App\Http\Middleware\VerifyCsrfToken;
use App\Models\Attribute;
use App\Models\Campaign;
use App\Models\Character;
use App\Models\Inventory;
use App\Models\Map;
use App\Models\Post;
use App\Models\Preset;
use App\Models\PresetType;
use App\Models\Relation;

require_once __DIR__ . '/support.php';

/**
 * @return array<string, mixed>
 */
function nestedBindingFixture(): array
{
    $public = Character::factory()->create(['campaign_id' => 1, 'name' => 'Harbor Watch'])->entity;
    $hidden = Character::factory()->create(['campaign_id' => 1, 'name' => 'dmonly-hidden-villain', 'is_private' => true])->entity;
    $hidden->update(['is_private' => true]);

    $post = Post::factory()->create(['entity_id' => $hidden->id, 'name' => 'dmonly-post', 'entry' => '<p>dmonly-post-entry</p>', 'visibility_id' => Visibility::All]);
    $attribute = Attribute::factory()->create(['entity_id' => $hidden->id, 'name' => 'dmonly-attribute', 'value' => 'dmonly-value', 'is_private' => false]);
    $relation = Relation::factory()->create(['owner_id' => $hidden->id, 'target_id' => $public->id, 'campaign_id' => 1, 'relation' => 'dmonly-relation', 'visibility_id' => Visibility::All]);
    $inventory = Inventory::create(['entity_id' => $hidden->id, 'name' => 'dmonly-inventory', 'amount' => 1, 'visibility_id' => Visibility::All, 'created_by' => 1]);

    // A record in a campaign the viewer isn't part of.
    Campaign::factory()->create(['slug' => 'other-campaign', 'name' => 'dmonly-other-campaign']);
    $foreign = Character::factory()->create(['campaign_id' => 2, 'name' => 'dmonly-foreign-character']);

    return compact('public', 'hidden', 'post', 'attribute', 'relation', 'inventory', 'foreign');
}

it('still serves a child through its own parent', function () {
    $this->asUser()->withCampaign();
    $fx = nestedBindingFixture();

    dmOnlyAdmin();
    $this->asWebRequest();
    $base = '/api/1.0/campaigns/1/entities/' . $fx['hidden']->id;
    $this->getJson($base . '/posts/' . $fx['post']->id)->assertOk();
    $this->getJson($base . '/relations/' . $fx['relation']->id)->assertOk();
    $this->getJson($base . '/inventory/' . $fx['inventory']->id)->assertOk();
    $this->getJson($base . '/attributes/' . $fx['attribute']->id)->assertOk();
});

it('refuses a hidden entity\'s records through a visible entity\'s URL', function () {
    $this->asUser()->withCampaign();
    $fx = nestedBindingFixture();

    dmOnlyPlayer();
    $this->asWebRequest();
    $base = '/api/1.0/campaigns/1/entities/' . $fx['public']->id;
    foreach ([
        'posts/' . $fx['post']->id,
        'relations/' . $fx['relation']->id,
        'inventory/' . $fx['inventory']->id,
        'attributes/' . $fx['attribute']->id,
    ] as $path) {
        $response = $this->getJson($base . '/' . $path);
        expect($response->status())->toBeIn([403, 404], $path);
        expectNoDmOnlyText($response, $path);
    }

    $details = $this->get(route('entities.inventory.details', [1, $fx['public'], $fx['inventory']]));
    expect($details->status())->toBeIn([403, 404], 'inventory details');
    expectNoDmOnlyText($details, 'inventory details');

    $logs = $this->get(route('entities.posts.logs', [1, $fx['public'], $fx['post']]));
    expect($logs->status())->toBeIn([403, 404], 'post logs');
    expectNoDmOnlyText($logs, 'post logs');
});

it('refuses another campaign\'s records through this campaign\'s URL', function () {
    $this->asUser()->withCampaign();
    $fx = nestedBindingFixture();

    foreach (['player' => fn () => dmOnlyPlayer(), 'admin' => fn () => dmOnlyAdmin()] as $who => $login) {
        $login();
        $this->asWebRequest();
        foreach ([
            '/api/1.0/campaigns/1/characters/' . $fx['foreign']->id,
            '/api/1.0/campaigns/1/entities/' . $fx['foreign']->entity->id,
        ] as $url) {
            $response = $this->getJson($url);
            expect($response->status())->toBeIn([403, 404], "{$who} {$url}");
            expectNoDmOnlyText($response, "{$who} {$url}");
        }
    }
});

it('gives the DM the editing warning only for this campaign\'s records', function () {
    $this->asUser()->withCampaign();
    $fx = nestedBindingFixture();
    $warning = fn (string $model, int $id) => $this->get(route('campaign.editing-warning', [1, 'model' => $model, 'id' => $id]));

    dmOnlyAdmin();
    $this->asWebRequest();
    $warning('Entity', $fx['public']->id)->assertOk();
    $warning('Post', $fx['post']->id)->assertOk();
    // Only the models that have an edit warning.
    $warning('User', 1)->assertNotFound();
    expect($warning('Entity', $fx['foreign']->entity->id)->status())->toBeIn([403, 404]);
});

it('refuses a player the editing warning of a hidden record', function () {
    $this->asUser()->withCampaign();
    $fx = nestedBindingFixture();
    $warning = fn (string $model, int $id) => $this->get(route('campaign.editing-warning', [1, 'model' => $model, 'id' => $id]));

    // A separate test from the admin's: the permission service caches the first user it sees.
    dmOnlyPlayer();
    $this->asWebRequest();
    foreach (['Entity' => $fx['hidden']->id, 'Post' => $fx['post']->id] as $model => $id) {
        $response = $warning($model, $id);
        expect($response->status())->toBeIn([403, 404], $model);
        expectNoDmOnlyText($response, "editing warning {$model}");
    }
});

it('refuses to turn another campaign\'s post into a template', function () {
    $this->asUser()->withCampaign();
    $fx = nestedBindingFixture();
    $foreignPost = Post::factory()->create(['entity_id' => $fx['foreign']->entity->id, 'name' => 'dmonly-foreign-post']);

    dmOnlyAdmin();
    $this->asWebRequest();
    $this->get(route('posts.template', [1, $foreignPost]))->assertNotFound();
    expect($foreignPost->fresh()->isTemplate())->toBeFalse();
});

it('refuses another campaign\'s preset through this campaign\'s URL', function () {
    $this->asUser()->withCampaign();
    $fx = nestedBindingFixture();
    $map = Map::factory()->create(['campaign_id' => 1]);
    $preset = Preset::create(['name' => 'dmonly-foreign-preset', 'type_id' => PresetType::MARKER, 'campaign_id' => 2, 'visibility_id' => Visibility::All, 'config' => []]);

    dmOnlyAdmin();
    $this->asWebRequest();
    $this->withoutMiddleware(VerifyCsrfToken::class);
    expect($this->getJson(route('preset_types.presets.show', [1, PresetType::MARKER, $preset->id]))->status())->toBeIn([403, 404]);
    expect($this->deleteJson(route('entities.map-presets.destroy', [1, $map->entity, $preset->id]))->status())->toBeIn([403, 404]);
    expect(Preset::allCampaigns()->withoutGlobalScopes()->find($preset->id))->not->toBeNull();
});
