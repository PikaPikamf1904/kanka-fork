<?php

/*
 * A dashboard without widgets shows Chronicle's overview: links to the campaign's modules and
 * the latest entries. The recent list must never name an entity the viewer can't see.
 */

use App\Models\Campaign;

require_once __DIR__ . '/support.php';

it('shows the overview with module links and recent entries on an empty dashboard', function () {
    $this->asUser()->withCampaign();
    $f = dmOnlyFixture();

    dmOnlyAdmin();
    $this->asWebRequest();
    $html = $this->get(route('dashboard', [1]))->assertOk()->getContent();

    expect($html)->toContain('chronicle-overview')
        ->toContain('Harbor Watch')
        // The DM sees their own hidden entries.
        ->toContain('dmonly-hidden-villain')
        ->toContain(e(route('connections.web', [Campaign::find(1)])));
});

it('keeps hidden entities out of a player\'s overview', function () {
    $this->asUser()->withCampaign();
    dmOnlyFixture();

    dmOnlyPlayer();
    $this->asWebRequest();
    $response = $this->get(route('dashboard', [1]))->assertOk();

    expect($response->getContent())->toContain('chronicle-overview')->toContain('Harbor Watch');
    expectNoDmOnlyText($response, 'dashboard overview');
});
