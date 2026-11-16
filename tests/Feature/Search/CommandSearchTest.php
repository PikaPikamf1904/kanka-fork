<?php

use App\Models\Campaign;
use App\Services\Search\AdminPageService;

// The header search ("command" mode) lists matching admin pages next to entities. Chronicle runs
// without the marketplace, so the plugin pages must not be linked: their routes do not exist and
// route() used to throw, turning every header search into a 500. (The entity half of the search
// uses MariaDB's RLIKE, so the full endpoint is checked in the browser run, not under SQLite.)

it('lists admin pages without the marketplace routes', function () {
    $this->asUser()->withCampaign();

    expect(Route::has('campaign_plugins.index'))->toBeFalse();

    $pages = app(AdminPageService::class)->campaign(Campaign::find(1))->match('');

    expect($pages)->not->toBeEmpty()
        ->and(collect($pages)->pluck('url')->implode(' '))->not->toContain('plugins');
});
