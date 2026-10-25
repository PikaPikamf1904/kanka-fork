<?php

/*
 * The floating relations graph (layouts/graph-panel.blade.php) embeds the relations web page,
 * focused on the entity being viewed. It must add no new way to see data: it appears only for
 * someone who may open the relations web, and the embedded page and its API stay filtered for
 * the viewer, whatever entity id the "focus" parameter names.
 */

use App\Enums\CampaignVisibility;
use App\Models\Campaign;

require_once __DIR__ . '/support.php';

it('offers the floating graph on entity pages, focused on that entity', function () {
    $this->asUser()->withCampaign();
    $f = dmOnlyFixture();

    dmOnlyAdmin();
    $this->asWebRequest();
    $html = $this->get(route('entities.show', [1, $f['public']->id]))->assertOk()->getContent();

    expect($html)->toContain('id="graph-panel-toggle"')
        ->toContain('id="graph-panel"')
        ->toContain('data-focus="' . $f['public']->id . '"')
        ->toContain(e(route('connections.web', [Campaign::find(1), 'embed' => 1])));
});

it('keeps the embedded graph filtered for a player, even when focused on a hidden entity', function () {
    $this->asUser()->withCampaign();
    $f = dmOnlyFixture();

    dmOnlyPlayer();
    $this->asWebRequest();
    $page = $this->get(route('entities.show', [1, $f['public']->id]))->assertOk();
    expect($page->getContent())->toContain('id="graph-panel-toggle"');

    $embed = $this->get(route('connections.web', [1, 'embed' => 1, 'focus' => $f['hidden']->id]))->assertOk();
    expectNoDmOnlyText($embed, 'embedded graph page');
    expect($embed->getContent())->toContain(':embed="true"');

    $api = $this->getJson(route('connections.web.api', [1]))->assertOk();
    expectNoDmOnlyText($api, 'embedded graph data');

    // The DM gets the same page with the hidden entity in its data.
    dmOnlyAdmin();
    $this->asWebRequest();
    expect($this->getJson(route('connections.web.api', [1]))->assertOk()->getContent())
        ->toContain('dmonly-hidden-villain');
});

it('only passes a numeric focus to the embedded graph', function () {
    $this->asUser()->withCampaign();

    $html = $this->get(route('connections.web', [1, 'embed' => 1, 'focus' => '"><script>x</script>']))
        ->assertOk()
        ->getContent();

    expect($html)->toContain('focus=""')
        ->not->toContain('<script>x</script>');
});

it('does not offer the floating graph to visitors who are not logged in', function () {
    $this->asUser()->withCampaign(['visibility_id' => CampaignVisibility::public]);
    $f = dmOnlyFixture();

    app('auth')->forgetGuards();
    $this->asWebRequest();
    $html = $this->get(route('entities.show', [1, $f['public']->id]))->getContent();

    expect($html)->not->toContain('graph-panel');
});
