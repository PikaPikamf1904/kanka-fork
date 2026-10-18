<?php

use App\Enums\CampaignVisibility;
use App\Enums\Visibility;
use App\Models\Character;
use App\Models\Image;
use App\Models\User;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\Storage;

require_once __DIR__ . '/support.php';

afterEach(fn () => entranceCleanup());

function storedUploadForTest(Visibility $visibility = Visibility::All): Image
{
    $image = Image::factory()->create([
        'campaign_id' => 1,
        'visibility_id' => $visibility,
    ]);
    Storage::disk('public')->put($image->path, 'disposable upload content');

    return $image;
}

function sharedGuestWithUploadGrant($test, $service): void
{
    entranceAsGuest();
    $test->asWebRequest();
    $test->withCookie(config('entrance.cookie'), entranceGrantPayload($service));
}

beforeEach(function () {
    Config::set('filesystems.default', 'public');
    Storage::fake('public');
});

it('gates direct upload requests before a visitor enters the shared password', function () {
    entranceBoot();
    $this->asUser()->withCampaign(['visibility_id' => CampaignVisibility::public]);
    $image = storedUploadForTest();

    entranceAsGuest();
    $this->asWebRequest()
        ->get('/storage/' . $image->path)
        ->assertRedirect(route('entrance.show'));
});

it('allows a shared-password visitor to load a public campaign image without granting login', function () {
    $service = entranceBoot();
    $this->asUser()->withCampaign(['visibility_id' => CampaignVisibility::public]);
    $image = storedUploadForTest();
    sharedGuestWithUploadGrant($this, $service);

    $this->get('/storage/' . $image->path)
        ->assertOk()
        ->assertSee('disposable upload content', false)
        ->assertHeader('Cache-Control', 'private, no-store, max-age=0')
        ->assertHeader('X-Content-Type-Options', 'nosniff');

    $this->assertGuest();
});

it('uses campaign ACLs for campaign header uploads', function () {
    $this->asUser()->withCampaign(['visibility_id' => CampaignVisibility::public]);
    $path = 'w/1/header.png';
    \App\Models\Campaign::findOrFail(1)->update(['image' => $path]);
    Storage::disk('public')->put($path, 'campaign header');

    entranceAsGuest();
    $this->asWebRequest()->get('/storage/' . $path)->assertOk()->assertSee('campaign header', false);

    \App\Models\Campaign::findOrFail(1)->update(['visibility_id' => CampaignVisibility::private]);
    entranceAsGuest();
    $this->asWebRequest()->get('/storage/' . $path)->assertNotFound();
});

it('checks the owning entity permissions for an image direct URL', function () {
    $service = entranceBoot();
    $this->asUser()->withCampaign(['visibility_id' => CampaignVisibility::public]);
    $image = storedUploadForTest();
    $character = Character::factory()->create(['campaign_id' => 1]);
    $character->entity->update(['is_private' => true, 'image_uuid' => $image->id]);
    $publicImage = storedUploadForTest();
    $publicCharacter = Character::factory()->create(['campaign_id' => 1]);
    $publicCharacter->entity->update(['image_uuid' => $publicImage->id]);

    sharedGuestWithUploadGrant($this, $service);
    $this->get('/storage/' . $image->path)->assertNotFound();

    $this->asPlayer()->asWebRequest();
    $this->get('/storage/' . $image->path)->assertNotFound();
    $this->get('/storage/' . $publicImage->path)->assertOk();

    $this->actingAs(User::findOrFail(1))->asWebRequest();
    $this->get('/storage/' . $image->path)
        ->assertOk()
        ->assertSee('disposable upload content', false);
});

it('does not serve public-looking image paths from a private campaign to a visitor', function () {
    $service = entranceBoot();
    $this->asUser()->withCampaign(['visibility_id' => CampaignVisibility::private]);
    $image = storedUploadForTest();
    sharedGuestWithUploadGrant($this, $service);

    $this->get('/storage/' . $image->path)->assertNotFound();
});

it('applies gallery image visibility to normal players while leaving DM access intact', function () {
    $this->asUser()->withCampaign(['visibility_id' => CampaignVisibility::public]);
    $image = storedUploadForTest(Visibility::Admin);

    $this->asPlayer()->asWebRequest();
    $this->get('/storage/' . $image->path)->assertNotFound();

    $this->actingAs(User::findOrFail(1))->asWebRequest();
    $this->get('/storage/' . $image->path)->assertOk();
});
