<?php

use App\Enums\CampaignVisibility;
use App\Models\Character;

require_once __DIR__ . '/support.php';

afterEach(fn () => entranceCleanup());

function enteredGuest($test, $service): void
{
    entranceAsGuest();
    $test->asWebRequest();
    $test->withCookie(config('entrance.cookie'), entranceGrantPayload($service));
}

it('keeps a granted visitor a guest: private campaigns stay closed', function () {
    $service = entranceBoot();
    $this->asUser()->withCampaign(['visibility_id' => CampaignVisibility::private]);
    $character = Character::factory()->create(['campaign_id' => 1, 'name' => 'Visible Hero'])->entity;
    enteredGuest($this, $service);

    $response = $this->get(route('entities.show', [1, $character]));
    // Kanka answers with its own "private campaign" page, which shows no content.
    $response->assertViewIs('errors.private-campaign');
    $this->assertGuest();
    expect($response->getContent())->not->toContain('Visible Hero');
});

it('shows a public campaign only as far as the Public role allows', function () {
    $service = entranceBoot();
    $this->asUser()->withCampaign(['visibility_id' => CampaignVisibility::public]);
    $normal = Character::factory()->create(['campaign_id' => 1, 'name' => 'Visible Hero'])->entity;
    $secret = Character::factory()->create(['campaign_id' => 1, 'name' => 'Hidden Villain', 'is_private' => true])->entity;
    $secret->update(['is_private' => true]);
    enteredGuest($this, $service);

    $this->get(route('entities.show', [1, $normal]))->assertOk()->assertSee('Visible Hero');
    $this->assertGuest();

    $response = $this->get(route('entities.show', [1, $secret]));
    expect($response->status())->not->toBe(200);
    expect($response->getContent())->not->toContain('Hidden Villain');
});

it('refuses writes from a granted visitor just like from any guest', function () {
    $service = entranceBoot();
    $this->asUser()->withCampaign(['visibility_id' => CampaignVisibility::public]);
    $character = Character::factory()->create(['campaign_id' => 1, 'name' => 'Visible Hero']);
    enteredGuest($this, $service);

    $create = $this->withSession(['_token' => 't'])->withHeader('X-CSRF-TOKEN', 't')
        ->post(route('characters.store', 1), ['name' => 'Injected']);
    expect($create->status())->toBeIn([302, 401, 403, 404]);

    $update = $this->withSession(['_token' => 't'])->withHeader('X-CSRF-TOKEN', 't')
        ->patch(route('characters.update', [1, $character]), ['name' => 'Defaced']);
    expect($update->status())->toBeIn([302, 401, 403, 404]);

    expect(Character::where('name', 'Injected')->exists())->toBeFalse();
    expect($character->fresh()->name)->toBe('Visible Hero');
});
