<?php

/*
 * The command search lists campaign admin pages. Players must only be offered the pages they
 * can open: no links to settings, roles, webhooks, the change log or recovery. The stats and
 * achievements pages count hidden entities, so they are admin-only too.
 */

use App\Models\Campaign;
use App\Services\Search\AdminPageService;

require_once __DIR__ . '/support.php';

function commandSearchPageUrls(): array
{
    return collect(app(AdminPageService::class)->campaign(Campaign::find(1))->match(''))
        ->pluck('url')
        ->all();
}

it('offers the admin pages to the campaign admin', function () {
    $this->asUser()->withCampaign();

    dmOnlyAdmin();
    $campaign = Campaign::find(1);

    expect(commandSearchPageUrls())
        ->toContain(route('campaigns.edit', $campaign))
        ->toContain(route('campaign_roles.index', $campaign))
        ->toContain(route('campaign.logs', $campaign))
        ->toContain(route('recovery', $campaign))
        ->toContain(route('campaign.stats', $campaign));
});

it('hides admin-only pages from a player', function () {
    $this->asUser()->withCampaign();

    dmOnlyPlayer();
    $campaign = Campaign::find(1);
    $urls = commandSearchPageUrls();

    foreach (['campaigns.edit', 'campaign_roles.index', 'webhooks.index', 'campaign.logs', 'campaign.modules', 'recovery', 'campaign_styles.index'] as $name) {
        expect($urls)->not->toContain(route($name, $campaign));
    }
    // The stats and achievements count hidden entities too.
    expect($urls)->not->toContain(route('campaign.stats', $campaign))
        ->not->toContain(route('campaign.achievements', $campaign));
});

it('refuses the admin pages themselves to a player', function () {
    $this->asUser()->withCampaign();

    dmOnlyPlayer();
    $this->asWebRequest();
    $campaign = Campaign::find(1);

    foreach (['campaigns.edit', 'campaign_roles.index', 'webhooks.index', 'campaign.logs', 'campaign.modules', 'recovery', 'campaign_styles.index', 'campaign.stats', 'campaign.achievements'] as $name) {
        expect($this->get(route($name, $campaign))->status())->toBeIn([403, 404], $name);
    }
});

it('shows the stats page to the campaign admin', function () {
    $this->asUser()->withCampaign();

    dmOnlyAdmin();
    $this->asWebRequest();

    $this->get(route('campaign.stats', [Campaign::find(1)]))->assertOk();
});
