<?php

/*
 * Chronicle adds a labelled "Relationship Graph" entry to the campaign sidebar (which is also the
 * mobile menu). It must only link to the existing relations web, which stays filtered per viewer.
 */

use App\Models\Campaign;

require_once __DIR__ . '/support.php';

it('shows the DM a labelled Relationship Graph entry in the campaign menu', function () {
    $this->asUser()->withCampaign();
    dmOnlyFixture();

    dmOnlyAdmin();
    $this->asWebRequest();
    $html = $this->get(route('dashboard', [1]))->assertOk()->getContent();

    expect($html)->toContain('section-graph')
        ->toContain('Relationship Graph')
        ->toContain(e(route('connections.web', [Campaign::find(1)])));
});

it('shows a player the same entry, and the graph it opens hides DM-only entities', function () {
    $this->asUser()->withCampaign();
    dmOnlyFixture();

    dmOnlyPlayer();
    $this->asWebRequest();
    $html = $this->get(route('dashboard', [1]))->assertOk()->getContent();
    expect($html)->toContain('section-graph')->toContain('Relationship Graph');

    $page = $this->get(route('connections.web', [1]))->assertOk();
    expectNoDmOnlyText($page, 'relationship graph page');
    $api = $this->get(route('connections.web.api', [1]))->assertOk();
    expectNoDmOnlyText($api, 'relationship graph data');
});
