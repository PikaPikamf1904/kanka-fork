<?php

use App\Enums\CampaignVisibility;
use App\Enums\Visibility;
use App\Models\Character;
use App\Models\Image;
use App\Models\Map;
use App\Models\MapLayer;
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

    $response = $this->get('/storage/' . $image->path)
        ->assertOk()
        ->assertHeader('X-Content-Type-Options', 'nosniff');

    expect($response->headers->get('Cache-Control'))
        ->toContain('private')
        ->toContain('no-store')
        ->toContain('max-age=0');
    expect($response->streamedContent())->toBe('disposable upload content');

    $this->assertGuest();
});

it('uses campaign ACLs for campaign header uploads', function () {
    $this->asUser()->withCampaign(['visibility_id' => CampaignVisibility::public]);
    $path = 'w/1/header.png';
    \App\Models\Campaign::findOrFail(1)->forceFill(['image' => $path])->saveQuietly();
    Storage::disk('public')->put($path, 'campaign header');

    entranceAsGuest();
    $response = $this->asWebRequest()->get('/storage/' . $path)->assertOk();
    expect($response->streamedContent())->toBe('campaign header');

    \App\Models\Campaign::findOrFail(1)->forceFill(['visibility_id' => CampaignVisibility::private])->saveQuietly();
    entranceAsGuest();
    $this->asWebRequest()->get('/storage/' . $path)->assertNotFound();
});

it('uses entity permissions for migrated legacy uploads', function () {
    $service = entranceBoot();
    $this->asUser()->withCampaign(['visibility_id' => CampaignVisibility::public]);
    $path = 'w/1/legacy/2a7678f4-fb92-5cf6-8f83-fb0ef8b60000.jpg';
    $character = Character::factory()->create(['campaign_id' => 1]);
    $character->entity->forceFill(['image_path' => $path])->saveQuietly();
    Storage::disk('public')->put($path, 'migrated legacy image');

    sharedGuestWithUploadGrant($this, $service);
    $this->get('/storage/' . $path)->assertOk();

    $character->entity->forceFill(['is_private' => true])->saveQuietly();
    sharedGuestWithUploadGrant($this, $service);
    $this->get('/storage/' . $path)->assertNotFound();

    $this->actingAs(User::findOrFail(1))->asWebRequest();
    $response = $this->get('/storage/' . $path)->assertOk();
    expect($response->streamedContent())->toBe('migrated legacy image');
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
    $response = $this->get('/storage/' . $image->path)->assertOk();
    expect($response->streamedContent())->toBe('disposable upload content');
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

it('keeps thumbnail and map tile URLs on the protected local upload route', function () {
    $service = entranceBoot();
    $this->asUser()->withCampaign(['visibility_id' => CampaignVisibility::public]);
    $image = storedUploadForTest();
    $image->forceFill(['tiling_status' => Image::TILING_FINISHED])->saveQuietly();
    $map = Map::factory()->create(['campaign_id' => 1]);
    $layer = MapLayer::factory()->create(['map_id' => $map->id]);
    $layer->forceFill(['image_uuid' => $image->id])->saveQuietly();

    config(['cdn.ugc' => 'https://cdn-ugc.kanka.io']);
    $thumbnail = app(\App\Services\ImgService::class)->crop(128, 128)->url($image->path);
    $tiles = $image->tilesUrlTemplate();

    expect($thumbnail)->toBe(Storage::disk('public')->url($image->path))
        ->and($tiles)->toBe(Storage::disk('public')->url($image->tilesPath() . '/{z}/{y}/{x}.webp'))
        ->and($thumbnail)->not->toContain('cdn-ugc.kanka.io')
        ->and($tiles)->not->toContain('cdn-ugc.kanka.io');

    $tilePath = $image->tilesPath() . '/0/0/0.webp';
    Storage::disk('public')->put($tilePath, 'public map tile');
    sharedGuestWithUploadGrant($this, $service);
    $this->get('/storage/' . $tilePath)->assertOk();

    $map->entity->forceFill(['is_private' => true])->saveQuietly();
    sharedGuestWithUploadGrant($this, $service);
    $this->get('/storage/' . $tilePath)->assertNotFound();

    $this->actingAs(User::findOrFail(1))->asWebRequest();
    $response = $this->get('/storage/' . $tilePath)->assertOk();
    expect($response->streamedContent())->toBe('public map tile');

    $map->entity->forceFill(['is_private' => false])->saveQuietly();
    $layer->forceFill(['visibility_id' => Visibility::Admin])->saveQuietly();
    entranceAsGuest();
    sharedGuestWithUploadGrant($this, $service);
    $this->get('/storage/' . $tilePath)->assertNotFound();

    $this->actingAs(User::findOrFail(1))->asWebRequest();
    $this->get('/storage/' . $tilePath)->assertOk();
});

it('routes existing storage files through Laravel on the built-in preview server', function () {
    $root = sys_get_temp_dir() . '/chronicle-router-' . bin2hex(random_bytes(8));
    $public = $root . '/public';
    mkdir($public . '/storage/campaigns/1', 0700, true);
    mkdir($public . '/images', 0700, true);
    copy(base_path('server.php'), $root . '/server.php');
    file_put_contents($public . '/index.php', '<?php echo "ROUTED_THROUGH_LARAVEL";');
    file_put_contents($public . '/storage/campaigns/1/private.png', 'disposable private asset');
    file_put_contents($public . '/images/logo.svg', 'disposable public branding');

    $dispatch = function (string $uri) use ($root): array {
        $_SERVER['REQUEST_URI'] = $uri;
        ob_start();
        $result = include $root . '/server.php';

        return [ob_get_clean(), $result];
    };

    try {
        [$storageBody] = $dispatch('/storage/campaigns/1/private.png');
        [$brandBody, $brandResult] = $dispatch('/images/logo.svg');

        expect($storageBody)->toBe('ROUTED_THROUGH_LARAVEL')
            ->and($brandBody)->toBe('')
            ->and($brandResult)->toBeFalse();
    } finally {
        @unlink($public . '/storage/campaigns/1/private.png');
        @unlink($public . '/images/logo.svg');
        @unlink($public . '/index.php');
        @unlink($root . '/server.php');
        @rmdir($public . '/storage/campaigns/1');
        @rmdir($public . '/storage/campaigns');
        @rmdir($public . '/storage');
        @rmdir($public . '/images');
        @rmdir($public);
        @rmdir($root);
    }
});
