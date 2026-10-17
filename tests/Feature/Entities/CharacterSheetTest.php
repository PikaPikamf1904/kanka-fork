<?php

/*
 * The D&D 2024 reference sheet of characters. The sheet is stored as properties, so it must keep
 * the same rules as the Properties tab: players never see, overwrite or learn about the DM's
 * private properties, and only those who may edit the character and its properties save it.
 *
 * Requests are made in web mode (not as the console), so Kanka's PrivateScope is live like on a
 * real server. All names and values are made up; "dmonly-" marks what players must never see.
 */

use App\Http\Middleware\VerifyCsrfToken;
use App\Models\Attribute;
use App\Models\Campaign;
use App\Models\CampaignPermission;
use App\Models\CampaignRoleUser;
use App\Models\CampaignSetting;
use App\Models\CampaignUser;
use App\Models\Character;
use App\Models\Location;
use App\Models\User;
use Illuminate\Foundation\Application;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Facade;

/**
 * Serve the next requests like a web server: not as the console, with fresh services.
 * A real request also gets a new database connection, so the permission service's temporary
 * table from the previous request is dropped too.
 */
function sheetWebMode(Application $app): void
{
    (fn () => $this->isRunningInConsole = false)->call($app);
    $instances = (fn () => array_keys($this->instances))->call($app);
    foreach ($instances as $abstract) {
        if (str_starts_with($abstract, 'App\\Services\\')) {
            $app->forgetInstance($abstract);
        }
    }
    Facade::clearResolvedInstances();
    DB::statement(DB::getDriverName() === 'sqlite'
        ? 'DROP TABLE IF EXISTS temp.tmp_permissions'
        : 'DROP TEMPORARY TABLE IF EXISTS tmp_permissions');
}

function sheetPlayer(int $id): User
{
    $player = User::factory()->create(['id' => $id]);
    CampaignUser::create(['campaign_id' => 1, 'user_id' => $player->id]);
    CampaignRoleUser::create(['campaign_role_id' => 3, 'user_id' => $player->id]);

    return $player;
}

/**
 * Let players (role 3) edit characters.
 */
function sheetPlayersCanEdit(): void
{
    CampaignPermission::create([
        'campaign_role_id' => 3,
        'access' => true,
        'action' => CampaignPermission::ACTION_EDIT,
        'entity_type_id' => config('entities.ids.character'),
    ]);
}

function sheetCharacter(): Character
{
    return Character::factory()->create(['campaign_id' => 1, 'name' => 'Ardent Cartographer']);
}

/**
 * @return array<string, mixed>
 */
function sheetInput(array $fields): array
{
    return ['fields' => $fields];
}

/**
 * The public property for a field: "Strength" finds "Strength[range:1,30]", not "Strength save".
 */
function sheetValue(int $entityId, string $base): ?Attribute
{
    return Attribute::withoutGlobalScopes()
        ->where('entity_id', $entityId)
        ->where(fn ($query) => $query->where('name', $base)->orWhere('name', 'like', $base . '[%'))
        ->where('is_private', false)
        ->orderBy('id')
        ->first();
}

beforeEach(function () {
    $this->asUser()->withCampaign();
    $this->withoutMiddleware(VerifyCsrfToken::class);
});

it('saves the sheet as properties and shows the derived numbers', function () {
    $character = sheetCharacter();
    $entity = $character->entity;

    $this->actingAs(User::find(1));
    sheetWebMode($this->app);
    $this->put(route('entities.sheet.update', [1, $entity]), sheetInput([
        'class' => 'Ranger',
        'species' => 'Human',
        'level' => 5,
        'strength' => 16,
        'wisdom' => 14,
        'dexterity' => 15,
        'strength_save' => '1',
        'dexterity_save' => '0',
        'athletics' => 'Proficient',
        'perception' => 'Expertise',
        'stealth' => 'None',
        'spellcasting' => 'Wisdom',
        'equipment' => "Longbow\nTraveller's cloak",
    ]))->assertRedirect(route('entities.sheet', [Campaign::find(1), $entity]));

    expect(sheetValue($entity->id, 'Level')->name)->toBe('Level[range:1,20]')
        ->and(sheetValue($entity->id, 'Level')->value)->toBe('5')
        ->and(sheetValue($entity->id, 'Strength save')->value)->toBe('1')
        ->and(sheetValue($entity->id, 'Dexterity save'))->toBeNull()
        ->and(sheetValue($entity->id, 'Athletics')->value)->toBe('Proficient')
        ->and(sheetValue($entity->id, 'Stealth'))->toBeNull()
        ->and(Attribute::withoutGlobalScopes()->where('entity_id', $entity->id)->where('name', 'Character sheet')->count())->toBe(1);

    sheetWebMode($this->app);
    $response = $this->get(route('entities.sheet', [1, $entity]))->assertOk();
    $html = (string) $response->getContent();
    // Strength 16 is +3, +3 more for the save; Athletics +3 + 3; Perception +2 + 6; DC 8 + 3 + 2.
    expect($html)->toContain('Ranger', 'Longbow<br', 'data-save="strength">+6<')
        ->and(preg_match('/data-skill="athletics".*?<strong[^>]*>\+6</s', $html))->toBe(1)
        ->and(preg_match('/data-skill="perception".*?<strong[^>]*>\+8</s', $html))->toBe(1)
        ->and(preg_match('/data-computed="passive_perception".*?>18</s', $html))->toBe(1)
        ->and(preg_match('/data-computed="spell_save_dc".*?>13</s', $html))->toBe(1);

    // Saving again reuses the same properties.
    sheetWebMode($this->app);
    $this->put(route('entities.sheet.update', [1, $entity]), sheetInput(['level' => 6, 'stealth' => 'Proficient']))
        ->assertRedirect();
    expect(Attribute::withoutGlobalScopes()->where('entity_id', $entity->id)->where('name', 'like', 'Level%')->count())->toBe(1)
        ->and(sheetValue($entity->id, 'Level')->value)->toBe('6')
        ->and(sheetValue($entity->id, 'Strength')->value)->toBe('16')
        ->and(sheetValue($entity->id, 'Stealth')->value)->toBe('Proficient');
});

it('picks up properties the character already has', function () {
    $entity = sheetCharacter()->entity;
    Attribute::factory()->create(['entity_id' => $entity->id, 'name' => 'strength', 'value' => '18', 'type_id' => 6]);

    $this->actingAs(User::find(1));
    sheetWebMode($this->app);
    $html = (string) $this->get(route('entities.sheet', [1, $entity]))->assertOk()->getContent();
    expect($html)->toContain('+4');

    sheetWebMode($this->app);
    $this->put(route('entities.sheet.update', [1, $entity]), sheetInput(['strength' => 12]))->assertRedirect();
    expect(Attribute::withoutGlobalScopes()->where('entity_id', $entity->id)->where('name', 'like', 'strength%')->count())->toBe(1)
        ->and(Attribute::withoutGlobalScopes()->where('entity_id', $entity->id)->where('name', 'strength')->first()->value)->toBe('12');
});

it('rejects values outside the sheet', function () {
    $entity = sheetCharacter()->entity;

    $this->actingAs(User::find(1));
    sheetWebMode($this->app);
    $this->from(route('entities.sheet.edit', [1, $entity]))
        ->put(route('entities.sheet.update', [1, $entity]), sheetInput([
            'level' => 21,
            'strength' => 0,
            'athletics' => 'Legendary',
            'spellcasting' => 'Strength',
            'class' => str_repeat('a', 192),
        ]))
        ->assertRedirect(route('entities.sheet.edit', [1, $entity]))
        ->assertSessionHasErrors(['fields.level', 'fields.strength', 'fields.athletics', 'fields.spellcasting', 'fields.class']);

    expect(Attribute::withoutGlobalScopes()->where('entity_id', $entity->id)->count())->toBe(0);
});

it('cleans text and shows API-written text safely', function () {
    $entity = sheetCharacter()->entity;
    // The API doesn't clean property values, so the sheet cleans them again when showing them.
    Attribute::factory()->create([
        'entity_id' => $entity->id,
        'name' => 'Backstory and personality',
        'type_id' => 2,
        'value' => '<script>alert("dmonly-xss")</script><b onclick="evil()">Bold</b>',
    ]);

    $this->actingAs(User::find(1));
    sheetWebMode($this->app);
    $html = (string) $this->get(route('entities.sheet', [1, $entity]))->assertOk()->getContent();
    expect($html)->not->toContain('alert("dmonly-xss")', 'onclick="evil()"')
        ->and($html)->toContain('<b>Bold</b>');

    sheetWebMode($this->app);
    $this->put(route('entities.sheet.update', [1, $entity]), sheetInput([
        'class' => 'Rogue <img src=x onerror=alert(1)>',
    ]))->assertRedirect();
    expect(sheetValue($entity->id, 'Class')->value)->not->toContain('onerror');
});

it('never shows, overwrites or reveals the DM\'s private properties to players', function () {
    sheetPlayersCanEdit();
    $entity = sheetCharacter()->entity;
    $private = Attribute::factory()->create([
        'entity_id' => $entity->id,
        'name' => 'Class',
        'value' => 'dmonly-secret-class',
        'is_private' => true,
        'default_order' => 50,
    ]);
    Attribute::factory()->create([
        'entity_id' => $entity->id,
        'name' => 'Backstory and personality',
        'type_id' => 2,
        'value' => 'dmonly-secret-backstory',
        'is_private' => true,
        'default_order' => 51,
    ]);
    Attribute::factory()->create([
        'entity_id' => $entity->id,
        'name' => 'Species',
        'value' => 'Elf',
        'default_order' => 1,
    ]);

    // The DM sees the private values, so the fixture is sound.
    $this->actingAs(User::find(1));
    sheetWebMode($this->app);
    expect((string) $this->get(route('entities.sheet', [1, $entity]))->assertOk()->getContent())
        ->toContain('dmonly-secret-class', 'dmonly-secret-backstory');

    $player = sheetPlayer(7401);
    $this->actingAs($player);
    $pages = [
        'sheet' => route('entities.sheet', [1, $entity]),
        'edit' => route('entities.sheet.edit', [1, $entity]),
        'print' => route('entities.sheet.print', [1, $entity]),
    ];
    foreach ($pages as $where => $url) {
        sheetWebMode($this->app);
        $html = (string) $this->get($url)->assertOk()->getContent();
        expect($html)->not->toContain('dmonly-', $where)
            ->and($html)->toContain('Elf');
    }

    sheetWebMode($this->app);
    $this->put(route('entities.sheet.update', [1, $entity]), sheetInput([
        'class' => 'Wizard',
        'backstory' => 'Grew up by the harbour.',
    ]))->assertRedirect();

    // The private ones are untouched, and the player's values are new public properties.
    expect($private->fresh()->value)->toBe('dmonly-secret-class')
        ->and(Attribute::withoutGlobalScopes()->where('entity_id', $entity->id)->where('value', 'dmonly-secret-backstory')->count())->toBe(1);
    $class = sheetValue($entity->id, 'Class');
    expect($class->value)->toBe('Wizard')
        ->and($class->is_private)->toBeFalse()
        // Placed after what the player can see, not after the private ones.
        ->and($class->default_order)->toBeLessThan(50);

    sheetWebMode($this->app);
    $html = (string) $this->get(route('entities.sheet', [1, $entity]))->assertOk()->getContent();
    expect($html)->not->toContain('dmonly-')
        ->and($html)->toContain('Wizard', 'Grew up by the harbour.');

    // The DM now sees what the players see: public properties come first.
    $this->actingAs(User::find(1));
    sheetWebMode($this->app);
    expect((string) $this->get(route('entities.sheet', [1, $entity]))->assertOk()->getContent())
        ->toContain('Wizard');
});

it('only lets those who may edit the character save its sheet', function () {
    $entity = sheetCharacter()->entity;
    Attribute::factory()->create(['entity_id' => $entity->id, 'name' => 'Level[range:1,20]', 'type_id' => 6, 'value' => '3']);

    $this->actingAs(sheetPlayer(7402));
    sheetWebMode($this->app);
    $this->get(route('entities.sheet', [1, $entity]))->assertOk();
    sheetWebMode($this->app);
    $this->get(route('entities.sheet.edit', [1, $entity]))->assertForbidden();
    sheetWebMode($this->app);
    $this->put(route('entities.sheet.update', [1, $entity]), sheetInput(['level' => 20, 'class' => 'Paladin']))->assertForbidden();

    expect(sheetValue($entity->id, 'Level')->value)->toBe('3')
        ->and(sheetValue($entity->id, 'Class'))->toBeNull();

    // Guests of a private campaign don't get in either. Kanka answers them with its "private
    // campaign" page, which it sends with status 200.
    $this->app['auth']->forgetGuards();
    sheetWebMode($this->app);
    expect(auth()->check())->toBeFalse();
    $this->put(route('entities.sheet.update', [1, $entity]), sheetInput(['level' => 20]))
        ->assertSee(__('errors.private-campaign.guest.helper'), false)
        ->assertSessionMissing('success');
    expect(sheetValue($entity->id, 'Level')->value)->toBe('3');
});

it('hides the sheet from players when the DM hides the properties', function () {
    sheetPlayersCanEdit();
    $entity = sheetCharacter()->entity;
    $entity->update(['is_attributes_private' => true]);
    Attribute::factory()->create(['entity_id' => $entity->id, 'name' => 'Class', 'value' => 'dmonly-hidden-class']);

    $this->actingAs(sheetPlayer(7403));
    foreach (['entities.sheet', 'entities.sheet.edit', 'entities.sheet.print'] as $route) {
        sheetWebMode($this->app);
        $this->get(route($route, [1, $entity]))->assertForbidden();
    }
    sheetWebMode($this->app);
    $this->put(route('entities.sheet.update', [1, $entity]), sheetInput(['class' => 'Bard']))->assertForbidden();
    sheetWebMode($this->app);
    expect((string) $this->get(route('entities.show', [1, $entity]))->getContent())
        ->not->toContain(route('entities.sheet', [1, $entity]));

    expect(Attribute::withoutGlobalScopes()->where('entity_id', $entity->id)->where('value', 'Bard')->count())->toBe(0);

    $this->actingAs(User::find(1));
    sheetWebMode($this->app);
    $this->get(route('entities.sheet', [1, $entity]))->assertOk()->assertSee('dmonly-hidden-class');
});

it('is only for characters', function () {
    $location = Location::factory()->create(['campaign_id' => 1]);

    $this->actingAs(User::find(1));
    foreach (['entities.sheet', 'entities.sheet.edit', 'entities.sheet.print'] as $route) {
        sheetWebMode($this->app);
        $this->get(route($route, [1, $location->entity]))->assertNotFound();
    }
    sheetWebMode($this->app);
    $this->put(route('entities.sheet.update', [1, $location->entity]), sheetInput(['class' => 'Fighter']))->assertNotFound();
    expect(Attribute::withoutGlobalScopes()->where('entity_id', $location->entity->id)->count())->toBe(0);
});

it('follows the properties module', function () {
    $entity = sheetCharacter()->entity;
    $setting = CampaignSetting::where('campaign_id', 1)->first();
    $setting->entity_attributes = false;
    $setting->save();
    Cache::flush();

    $this->actingAs(User::find(1));
    sheetWebMode($this->app);
    $this->get(route('entities.sheet', [1, $entity]))->assertRedirect(route('entities.show', [Campaign::find(1), $entity]));
    sheetWebMode($this->app);
    $this->put(route('entities.sheet.update', [1, $entity]), sheetInput(['class' => 'Fighter']))->assertRedirect();
    expect(Attribute::withoutGlobalScopes()->where('entity_id', $entity->id)->count())->toBe(0);
});

it('links the sheet from the character for editors and when there is a sheet', function () {
    sheetPlayersCanEdit();
    $entity = sheetCharacter()->entity;
    $other = sheetCharacter()->entity;
    Attribute::factory()->create(['entity_id' => $other->id, 'name' => 'Class', 'value' => 'Cleric']);

    $this->actingAs(User::find(1));
    sheetWebMode($this->app);
    $this->get(route('entities.show', [1, $entity]))->assertOk()->assertSee(route('entities.sheet', [Campaign::find(1), $entity]), false);

    // A player who can't edit only gets the link once the character has a sheet.
    $readOnly = User::factory()->create(['id' => 7404]);
    CampaignUser::create(['campaign_id' => 1, 'user_id' => $readOnly->id]);
    CampaignRoleUser::create(['campaign_role_id' => 2, 'user_id' => $readOnly->id]);
    $this->actingAs($readOnly);
    sheetWebMode($this->app);
    $this->get(route('entities.show', [1, $entity]))->assertOk()->assertDontSee(route('entities.sheet', [Campaign::find(1), $entity]), false);
    sheetWebMode($this->app);
    $this->get(route('entities.show', [1, $other]))->assertOk()->assertSee(route('entities.sheet', [Campaign::find(1), $other]), false);
});

it('prints with the SRD attribution and tracks no combat', function () {
    $entity = sheetCharacter()->entity;

    $this->actingAs(User::find(1));
    sheetWebMode($this->app);
    $this->get(route('entities.sheet.print', [1, $entity]))->assertOk()
        ->assertSee('System Reference Document 5.2')
        ->assertSee('Creative Commons Attribution 4.0');

    sheetWebMode($this->app);
    $html = mb_strtolower((string) $this->get(route('entities.sheet.edit', [1, $entity]))->assertOk()->getContent());
    foreach (['hit points', 'initiative', 'death save', 'roll'] as $tracker) {
        expect(preg_match('/name="fields\[[^\]]*' . preg_quote(str_replace(' ', '_', $tracker), '/') . '/', $html))->toBe(0, $tracker);
    }
    expect($html)->toContain('name="fields[strength]"', 'name="fields[athletics]"', 'name="fields[backstory]"');
});
