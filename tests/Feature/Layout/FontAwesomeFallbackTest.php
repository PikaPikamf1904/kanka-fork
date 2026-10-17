<?php

use App\Models\EntityType;
use Database\Seeders\EntityTypesTableSeeder;

it('loads the free icons and their fallbacks without a Font Awesome kit', function () {
    config(['fontawesome.kit' => null]);
    $this->asUser();

    $this->get(route('settings.appearance'))
        ->assertOk()
        ->assertSee('/vendor/fontawesome/6.0.0/css/all.min.css', false)
        ->assertSee('/css/fontawesome-free.css', false)
        ->assertDontSee('kit.fontawesome.com/', false);
});

it('leaves the icons to the kit when there is one', function () {
    config(['fontawesome.kit' => 'testkit123']);
    $this->asUser();

    $this->get(route('settings.appearance'))
        ->assertOk()
        ->assertSee('https://kit.fontawesome.com/testkit123.js', false)
        ->assertDontSee('/css/fontawesome-free.css', false);
});

it('has a free icon for every entity type', function () {
    $this->seed(EntityTypesTableSeeder::class);
    $css = file_get_contents(public_path('vendor/fontawesome/6.0.0/css/all.css'))
        . file_get_contents(public_path('css/fontawesome-free.css'));

    $icons = EntityType::default()->pluck('icon');
    expect($icons)->not->toBeEmpty();
    foreach ($icons as $icon) {
        expect($css)->toContain('.' . $icon . '::before');
    }
});

it('ships the fallback stylesheet and the fonts it points to', function () {
    $css = file_get_contents(public_path('css/fontawesome-free.css'));

    expect($css)->toContain('Font Awesome Free 6.0.0')
        ->and($css)->toContain('.fa-regular, .far')
        ->and($css)->toContain('.fa-duotone, .fad');

    preg_match_all('#url\((/vendor/fontawesome/[^)]+)\)#', $css, $fonts);
    expect($fonts[1])->not->toBeEmpty();
    foreach ($fonts[1] as $font) {
        expect(public_path(mb_ltrim($font, '/')))->toBeFile();
    }
});
