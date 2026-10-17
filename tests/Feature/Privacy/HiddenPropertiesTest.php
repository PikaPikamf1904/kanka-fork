<?php

/*
 * A DM can hide every property (attribute) of an entity from players with the "properties are
 * private" switch (entities.is_attributes_private). The properties tab honours it, so every other
 * place that shows properties must too: print and export, the API, post layouts and ability notes.
 *
 * Like DmOnlyContentTest, these make real HTTP requests in web mode and use "dmonly-" markers.
 */

use App\Enums\Visibility;
use App\Http\Middleware\VerifyCsrfToken;
use App\Models\Ability;
use App\Models\Attribute;
use App\Models\CampaignRoleUser;
use App\Models\CampaignUser;
use App\Models\Character;
use App\Models\EntityAbility;
use App\Models\Post;
use App\Models\PostLayout;
use App\Models\User;
use Laravel\Passport\Passport;

function hiddenPropertiesPlayer(): User
{
    $player = User::factory()->create(['id' => 7301]);
    CampaignUser::create(['campaign_id' => 1, 'user_id' => $player->id]);
    CampaignRoleUser::create(['campaign_role_id' => 3, 'user_id' => $player->id]);
    Passport::actingAs($player, ['*']);

    return $player;
}

function hiddenPropertiesAdmin(): void
{
    Passport::actingAs(User::find(1), ['*']);
}

function expectNoHiddenProperty($response, string $where): void
{
    $content = (string) $response->getContent();
    $at = mb_strpos($content, 'dmonly-');
    $context = $at === false ? '' : mb_substr($content, max(0, $at - 200), 300);
    expect($at)->toBeFalse($where . ' leaked a hidden property: ' . $context);
}

/**
 * A public character whose properties are all hidden by the switch. None of the attributes is
 * private on its own, so only the switch keeps them from players.
 *
 * @return array<string, mixed>
 */
function hiddenPropertiesFixture(): array
{
    $character = Character::factory()->create(['campaign_id' => 1, 'name' => 'Quiet Archivist']);
    $entity = $character->entity;
    $entity->update(['is_attributes_private' => true]);

    Attribute::factory()->create([
        'entity_id' => $entity->id,
        'name' => 'dmonly-property-name',
        'value' => 'dmonly-property-value',
        'is_private' => false,
        'is_pinned' => true,
    ]);

    $layout = PostLayout::firstOrCreate(['code' => 'attributes']);
    Post::factory()->create([
        'entity_id' => $entity->id,
        'name' => 'Properties post',
        'layout_id' => $layout->id,
        'visibility_id' => Visibility::All,
    ]);

    return compact('character', 'entity');
}

it('keeps hidden properties out of every page, export and API', function () {
    $this->asUser()->withCampaign();
    ['character' => $character, 'entity' => $entity] = hiddenPropertiesFixture();

    $gets = [
        'entity page' => route('entities.show', [1, $entity]),
        'tooltip' => route('entities.tooltip', [1, $entity]),
        'preview' => route('entities.preview', [1, $entity]),
        'print' => route('entities.html-export', [1, $entity]),
        'markdown export' => route('entities.markdown.export', [1, $entity]),
        'json export' => route('entities.json.export', [1, $entity]),
        'properties tab' => route('entities.attributes', [1, $entity]),
        'api entity' => '/api/1.0/campaigns/1/entities/' . $entity->id . '?related=1',
        'api character' => '/api/1.0/campaigns/1/characters/' . $character->id . '?related=1',
        'api characters' => '/api/1.0/campaigns/1/characters?related=1',
        'api attributes' => '/api/1.0/campaigns/1/entities/' . $entity->id . '/attributes',
    ];

    $player = hiddenPropertiesPlayer();
    $this->asWebRequest();
    // Collect every leak before failing, so one run lists all the places that need fixing.
    $leaks = [];
    foreach ($gets as $where => $url) {
        $response = $this->get($url, str_starts_with($url, '/api/') ? ['Accept' => 'application/json'] : []);
        expect($response->status())->toBeIn([200, 403, 404], $where);
        if (str_contains((string) $response->getContent(), 'dmonly-')) {
            $leaks[] = $where;
        }
    }
    // Bulk print sits behind the session 'auth' middleware, which needs the web guard. In web
    // mode the CSRF check is live, so it is switched off for this one request.
    $response = $this->actingAs($player)->withoutMiddleware(VerifyCsrfToken::class)->post(route('bulk.print', [1, config('entities.ids.character')]), ['model' => [$character->id]]);
    expect($response->status())->toBeIn([200, 403], 'bulk print');
    if (str_contains((string) $response->getContent(), 'dmonly-')) {
        $leaks[] = 'bulk print';
    }
    expect($leaks)->toBe([]);

    // The DM still sees them everywhere, so the fixture is sound.
    hiddenPropertiesAdmin();
    $this->asWebRequest();
    foreach (['print', 'markdown export', 'properties tab', 'api entity'] as $where) {
        $response = $this->get($gets[$where], str_starts_with($gets[$where], '/api/') ? ['Accept' => 'application/json'] : []);
        expect(str_contains((string) $response->getContent(), 'dmonly-property-value'))->toBeTrue($where . ' hides the property from the DM');
    }
});

it('keeps hidden properties of an ability out of the abilities it is attached to', function () {
    $this->asUser()->withCampaign();

    $ability = Ability::factory()->create(['campaign_id' => 1, 'name' => 'Lantern Ward']);
    $ability->entity->update(['is_attributes_private' => true]);
    Attribute::factory()->create([
        'entity_id' => $ability->entity->id,
        'name' => 'Charges',
        'value' => 'dmonly-ability-property',
        'is_private' => false,
    ]);
    $owner = Character::factory()->create(['campaign_id' => 1, 'name' => 'Ward Bearer'])->entity;
    EntityAbility::factory()->create([
        'entity_id' => $owner->id,
        'ability_id' => $ability->id,
        'note' => 'Charges left: {Charges}',
        'visibility_id' => Visibility::All,
    ]);

    hiddenPropertiesPlayer();
    $this->asWebRequest();
    foreach ([
        'ability page' => route('entities.show', [1, $ability->entity]),
        'abilities api' => route('entities.entity_abilities.api', [1, $owner]),
        'owner print' => route('entities.html-export', [1, $owner]),
    ] as $where => $url) {
        $response = $this->get($url);
        expect($response->status())->toBeIn([200, 403], $where);
        expectNoHiddenProperty($response, $where);
    }

    hiddenPropertiesAdmin();
    $this->asWebRequest();
    expect((string) $this->get(route('entities.entity_abilities.api', [1, $owner]))->getContent())
        ->toContain('dmonly-ability-property');
});
