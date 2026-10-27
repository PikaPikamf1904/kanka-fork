<?php

/*
 * The JSON API must not leak the existence of hidden entities through relation, mention or
 * ability rows. The DM-only text marker test cannot see these leaks because the rows only
 * carry ids, so these tests look for the hidden entity's id in the response.
 */

use App\Enums\Visibility;
use App\Models\Ability;
use App\Models\Entity;
use App\Models\EntityAbility;
use App\Models\EntityMention;
use App\Models\Inventory;
use App\Models\Item;
use App\Models\Relation;

require_once __DIR__ . '/support.php';

it('does not list relations owned by a hidden entity in the campaign relation API', function () {
    $this->asUser()->withCampaign();
    ['public' => $public, 'hidden' => $hidden] = dmOnlyFixture();
    $relation = Relation::factory()->create([
        'campaign_id' => 1,
        'owner_id' => $hidden->id,
        'target_id' => $public->id,
        'relation' => 'owned-by-hidden',
    ]);

    dmOnlyPlayer();
    $this->asWebRequest();
    $ids = collect($this->getJson('/api/1.0/campaigns/1/relations')->assertOk()->json('data'))->pluck('id');
    expect($ids)->not->toContain($relation->id);

    dmOnlyAdmin();
    $this->asWebRequest();
    $ids = collect($this->getJson('/api/1.0/campaigns/1/relations')->assertOk()->json('data'))->pluck('id');
    expect($ids)->toContain($relation->id);
});

it('refuses a single relation whose target is hidden from the player', function () {
    $this->asUser()->withCampaign();
    ['public' => $public, 'hidden' => $hidden, 'ally' => $ally] = dmOnlyFixture();
    $toHidden = Relation::factory()->create([
        'campaign_id' => 1,
        'owner_id' => $public->id,
        'target_id' => $hidden->id,
        'relation' => 'to-hidden',
    ]);
    $toAlly = Relation::factory()->create([
        'campaign_id' => 1,
        'owner_id' => $public->id,
        'target_id' => $ally->id,
        'relation' => 'to-ally',
    ]);

    $base = '/api/1.0/campaigns/1/entities/' . $public->id . '/relations/';

    dmOnlyPlayer();
    $this->asWebRequest();
    $this->getJson($base . $toHidden->id)->assertNotFound();
    $this->getJson($base . $toAlly->id)->assertOk();

    dmOnlyAdmin();
    $this->asWebRequest();
    $this->getJson($base . $toHidden->id)->assertOk();
});

it('does not list mentions of hidden entities in the mention API', function () {
    $this->asUser()->withCampaign();
    ['public' => $public, 'hidden' => $hidden, 'ally' => $ally] = dmOnlyFixture();
    EntityMention::query()->where('entity_id', $public->id)->delete();
    foreach ([$hidden, $ally] as $target) {
        EntityMention::create([
            'mentionable_type' => Entity::class,
            'mentionable_id' => $public->id,
            'entity_id' => $public->id,
            'target_id' => $target->id,
        ]);
    }

    $url = '/api/1.0/campaigns/1/entities/' . $public->id . '/mentions';

    dmOnlyPlayer();
    $this->asWebRequest();
    $targets = collect($this->getJson($url)->assertOk()->json('data'))->pluck('target_id');
    expect($targets)->toContain($ally->id)->not->toContain($hidden->id);

    dmOnlyAdmin();
    $this->asWebRequest();
    $targets = collect($this->getJson($url)->assertOk()->json('data'))->pluck('target_id');
    expect($targets)->toContain($hidden->id);
});

it('does not list or show abilities that are hidden from the player', function () {
    $this->asUser()->withCampaign();
    ['public' => $public] = dmOnlyFixture();
    $visible = Ability::factory()->create(['campaign_id' => 1, 'name' => 'Shield Wall']);
    $secret = Ability::factory()->create(['campaign_id' => 1, 'name' => 'Secret Art', 'is_private' => true]);
    $secret->entity->update(['is_private' => true]);

    $visibleRow = EntityAbility::factory()->create(['entity_id' => $public->id, 'ability_id' => $visible->id]);
    $secretRow = EntityAbility::factory()->create(['entity_id' => $public->id, 'ability_id' => $secret->id]);

    $base = '/api/1.0/campaigns/1/entities/' . $public->id . '/entity_abilities';

    dmOnlyPlayer();
    $this->asWebRequest();
    $ids = collect($this->getJson($base)->assertOk()->json('data'))->pluck('id');
    expect($ids)->toContain($visibleRow->id)->not->toContain($secretRow->id);
    $this->getJson($base . '/' . $secretRow->id)->assertNotFound();
    $this->getJson($base . '/' . $visibleRow->id)->assertOk();

    dmOnlyAdmin();
    $this->asWebRequest();
    $ids = collect($this->getJson($base)->assertOk()->json('data'))->pluck('id');
    expect($ids)->toContain($secretRow->id);
});

it('does not list or show inventory rows for items hidden from the player', function () {
    $this->asUser()->withCampaign();
    ['public' => $public] = dmOnlyFixture();
    $visible = Item::factory()->create(['campaign_id' => 1, 'name' => 'Lantern']);
    $secret = Item::factory()->create(['campaign_id' => 1, 'name' => 'Cursed Blade', 'is_private' => true]);
    $secret->entity->update(['is_private' => true]);

    $make = fn (array $attributes) => Inventory::create($attributes + [
        'entity_id' => $public->id,
        'amount' => 1,
        'visibility_id' => Visibility::All,
    ]);
    $visibleRow = $make(['item_id' => $visible->id]);
    $secretRow = $make(['item_id' => $secret->id]);
    $namedRow = $make(['name' => 'Loose coins']);

    $base = '/api/1.0/campaigns/1/entities/' . $public->id . '/inventory';

    dmOnlyPlayer();
    $this->asWebRequest();
    $ids = collect($this->getJson($base)->assertOk()->json('data'))->pluck('id');
    expect($ids)->toContain($visibleRow->id)->toContain($namedRow->id)->not->toContain($secretRow->id);
    $this->getJson($base . '/' . $secretRow->id)->assertNotFound();
    $this->getJson($base . '/' . $visibleRow->id)->assertOk();

    dmOnlyAdmin();
    $this->asWebRequest();
    $ids = collect($this->getJson($base)->assertOk()->json('data'))->pluck('id');
    expect($ids)->toContain($secretRow->id);
});
