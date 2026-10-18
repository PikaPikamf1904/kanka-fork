<?php

/**
 * Visible text of a page: markup, scripts, styles and comments removed.
 */
function chronicleVisibleText(string $html): string
{
    $html = preg_replace('~<(script|style|svg)\b.*?</\1>~is', ' ', $html);
    $html = preg_replace('~<!--.*?-->~s', ' ', $html);

    return html_entity_decode(strip_tags($html), ENT_QUOTES | ENT_HTML5);
}

/**
 * Visible text without the credit line, which is the one place Kanka is named.
 */
function chronicleTextWithoutCredit(string $html): string
{
    $html = preg_replace('~<div class="chronicle-credit.*?</div>~is', ' ', $html);

    return chronicleVisibleText($html);
}

beforeEach(function () {
    config(['chronicle.hide_promotions' => true]);
});

it('is named Chronicle on the login page', function () {
    $response = $this->get(route('login'))->assertOk();

    $response->assertSee('Chronicle');
    expect(chronicleTextWithoutCredit($response->getContent()))->not->toContain('Kanka');
});

it('is named Chronicle on the campaign dashboard', function () {
    $response = $this->asUser()->withCampaign()
        ->get(route('dashboard', 1))
        ->assertOk();

    $response->assertSee('Chronicle');
    expect(chronicleTextWithoutCredit($response->getContent()))->not->toContain('Kanka');
});

it('is named Chronicle in the settings', function () {
    $response = $this->asUser()
        ->get(route('settings.profile'))
        ->assertOk();

    $response->assertSee('Chronicle');
    expect(chronicleTextWithoutCredit($response->getContent()))->not->toContain('Kanka');
});

it('uses local favicons and manifest', function () {
    $html = $this->get(route('login'))->assertOk()->getContent();

    preg_match_all('~<link[^>]+rel="(?:icon|apple-touch-icon|manifest|shortcut icon)"[^>]*>~i', $html, $links);
    expect($links[0])->not->toBeEmpty();
    foreach ($links[0] as $link) {
        expect($link)->not->toContain('kanka.io');
        expect($link)->not->toContain('kanka.');
    }
    expect($html)->toContain('images/favicon/favicon.svg');

    foreach (['favicon.ico', 'images/favicon/favicon.svg', 'images/favicon/site.webmanifest', 'images/chronicle/logo.svg'] as $file) {
        expect(public_path($file))->toBeFile();
    }
});

it('has no kanka.io links on the main pages when promotions are hidden', function () {
    $this->asUser()->withCampaign();

    $urls = [
        route('login'),
        route('dashboard', 1),
        route('settings.profile'),
        route('campaign.logs', 1),
    ];
    foreach ($urls as $url) {
        $html = $this->get($url)->getContent();
        // Strip the credit's single github link and the Leaflet/OSM-style attributions
        preg_match_all('~(?:href|src)="[^"]*kanka\.io[^"]*"~i', $html, $found);
        expect($found[0])->toBeEmpty($url . " links to " . implode(", ", $found[0]));
    }
});

it('shows the footer credit and the Owlchester copyright', function () {
    $html = $this->asUser()->withCampaign()
        ->get(route('dashboard', 1))
        ->assertOk()
        ->getContent();

    expect($html)
        ->toContain('built on')
        ->toContain('https://github.com/owlchester/kanka')
        ->toContain('Owlchester SNC');
});

it('lets CHRONICLE_NAME rename the site', function () {
    config(['chronicle.name' => 'Krynn Archive']);

    $response = $this->get(route('login'))->assertOk();
    $response->assertSee('Krynn Archive');
    expect(chronicleTextWithoutCredit($response->getContent()))->not->toContain('Chronicle');
});

it('keeps premium features locked when promotions are hidden', function () {
    $this->asUser()->withCampaign();

    $with = $this->get(route('campaign.achievements', 1))->status();
    config(['chronicle.hide_promotions' => false]);
    $without = $this->get(route('campaign.achievements', 1))->status();
    expect($with)->toBe($without);

    config(['chronicle.hide_promotions' => true]);
    $this->get(route('recovery.setup', 1))
        ->assertOk()
        ->assertJsonPath('acl.premium', false);
});

it('replaces the premium call to action with a neutral message', function () {
    $response = $this->asUser()->withCampaign(['boost_count' => 1])
        ->get(route('campaign.achievements', 1))
        ->assertOk();

    $response->assertDontSee(route('settings.subscription', ['f' => 'cta', 's' => 'achievements', 'w' => 1]), false);
});

it('does not render ads or the free trial banner when promotions are hidden', function () {
    $html = $this->asUser()->withCampaign()
        ->get(route('dashboard', 1))
        ->assertOk()
        ->getContent();

    expect($html)->not->toContain('banner_free_trial');
});
