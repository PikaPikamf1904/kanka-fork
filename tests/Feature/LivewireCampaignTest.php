<?php

use App\Models\Campaign;
use Database\Seeders\VisibilitiesTableSeeder;
use Illuminate\Support\Facades\URL;

it('livewire update uri includes campaign slug when url defaults are set', function () {
    URL::defaults(['campaign' => 'my-campaign']);
    expect(app('livewire')->getUpdateUri())->toBe('/livewire/update/my-campaign');
});

it('livewire update route resolves campaign binding for member', function () {
    $this->asUser()->withCampaign();
    $campaign = Campaign::first();

    // Livewire itself answers an empty update with 404, so check the binding, not the status.
    $this->post('/livewire/update/' . $campaign->slug, []);

    expect(app('router')->current()->parameter('campaign'))
        ->toBeInstanceOf(Campaign::class)
        ->id->toBe($campaign->id);
});

it('livewire update route blocks access to unauthorized campaign', function () {
    $this->asUser(); // user has no campaigns
    $this->seed(VisibilitiesTableSeeder::class);
    $otherCampaign = Campaign::factory()->create(['slug' => 'other-campaign']);

    // A campaign the user cannot see gets Kanka's "private campaign" page, never the component.
    $this->post('/livewire/update/' . $otherCampaign->slug, [])
        ->assertViewIs('errors.private-campaign');

    expect(app('router')->current()->parameter('campaign'))->not->toBeInstanceOf(Campaign::class);
});

it('livewire update uri is bare when no campaign url default is set', function () {
    expect(app('livewire')->getUpdateUri())->toBe('/livewire/update');
});
