<?php

/*
 * Chronicle runs without Meilisearch (SCOUT_DRIVER=null), so full-text search falls back to the
 * database. It must still answer (no 500), and a player must not find hidden entities by name
 * or by words in their entry.
 */

use App\Models\Character;

require_once __DIR__ . '/support.php';

function fullTextFixture(): void
{
    Character::factory()->create(['campaign_id' => 1, 'name' => 'Harbor Watch'])
        ->entity->update(['entry' => '<p>The watch guards the silver harbor at night.</p>']);

    $hidden = Character::factory()->create(['campaign_id' => 1, 'name' => 'dmonly-silver-spy', 'is_private' => true])->entity;
    $hidden->update(['is_private' => true, 'entry' => '<p>dmonly-entry Sells silver harbor secrets.</p>']);
}

beforeEach(function () {
    config(['scout.driver' => 'null']);
});

it('finds entities by name and entry without Meilisearch', function () {
    $this->asUser()->withCampaign();
    fullTextFixture();

    dmOnlyAdmin();
    $this->asWebRequest();
    $this->get(route('search.fulltext', [1, 'term' => 'silver harbor']))
        ->assertOk()
        ->assertSee('Harbor Watch')
        ->assertSee('dmonly-silver-spy');
});

it('keeps hidden entities out of a player\'s full-text results', function () {
    $this->asUser()->withCampaign();
    fullTextFixture();

    dmOnlyPlayer();
    $this->asWebRequest();
    $response = $this->get(route('search.fulltext', [1, 'term' => 'silver harbor']))
        ->assertOk()
        ->assertSee('Harbor Watch');
    expectNoDmOnlyText($response, 'full-text page');

    // The redirecting /search?q= entry point lands on the same page.
    $this->get(route('search', [1, 'q' => 'silver']))->assertRedirect();
});

it('gives the command center snippets without Meilisearch, minus hidden entities', function () {
    $this->asUser()->withCampaign();
    fullTextFixture();

    dmOnlyPlayer();
    $this->asWebRequest();
    $response = $this->getJson(route('search.command', [1, 'q' => 'silver', 'mode' => 'fulltext']))->assertOk();
    expectNoDmOnlyText($response, 'command center full-text');
    $results = $response->json('results');

    expect(collect($results)->pluck('name')->all())->toBe(['Harbor Watch']);
    expect($results[0]['snippet'])->toContain('<mark>silver</mark>');
    expect(json_encode($results))->not->toContain('dmonly');
});

it('searches the full-text API without Meilisearch', function () {
    $this->asUser()->withCampaign();
    fullTextFixture();

    dmOnlyPlayer();
    $this->asWebRequest();
    $response = $this->getJson('/api/1.0/campaigns/1/fulltext-search?term=silver')->assertOk();
    expect(collect($response->json())->pluck('entity')->values()->all())->toBe(['Harbor Watch']);
    expectNoDmOnlyText($response, 'full-text API');
});

it('falls back to the database when Meilisearch is configured but unreachable', function () {
    $this->asUser()->withCampaign();
    fullTextFixture();
    config(['scout.driver' => 'meilisearch', 'scout.meilisearch.host' => 'http://127.0.0.1:1']);

    dmOnlyPlayer();
    $this->asWebRequest();
    $response = $this->get(route('search.fulltext', [1, 'term' => 'silver harbor']))
        ->assertOk()
        ->assertSee('Harbor Watch');
    expectNoDmOnlyText($response, 'full-text page after Meilisearch failure');

    $command = $this->getJson(route('search.command', [1, 'q' => 'silver', 'mode' => 'fulltext']))->assertOk();
    expect(collect($command->json('results'))->pluck('name')->all())->toBe(['Harbor Watch']);
});
