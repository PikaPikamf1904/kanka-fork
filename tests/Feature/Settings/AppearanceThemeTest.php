<?php

use Illuminate\Foundation\Vite;
use Illuminate\Support\HtmlString;

beforeEach(function () {
    // Shows which stylesheets a page asks Vite for, without needing built assets.
    $this->swap(Vite::class, new class extends Vite
    {
        public function __invoke($entrypoints, $buildDirectory = null)
        {
            return new HtmlString(collect($entrypoints)
                ->map(fn ($entrypoint) => '<link data-vite="' . e($entrypoint) . '">')
                ->implode(''));
        }
    });
});

it('saves the theme the user picks', function (string $theme) {
    $this->asUser();

    $this->patch(route('settings.appearance.update'), ['theme' => $theme])
        ->assertSessionHasNoErrors()
        ->assertRedirect(route('settings.appearance'));

    expect(auth()->user()->fresh()->theme)->toBe($theme);

    $page = $this->get(route('settings.appearance'))
        ->assertOk()
        ->assertSee('data-vite="resources/css/themes/' . $theme . '.css"', false)
        ->getContent();
    expect($page)->toMatch('/name="theme"[^>]*value="' . $theme . '"\s+checked="checked"/');
})->with(['dark', 'midnight', 'chronicle']);

it('goes back to the light theme when none is picked', function () {
    $this->asUser();
    auth()->user()->update(['theme' => 'chronicle']);

    $this->patch(route('settings.appearance.update'), ['theme' => ''])
        ->assertSessionHasNoErrors();

    expect(auth()->user()->fresh()->theme)->toBeNull();
    $this->get(route('settings.appearance'))
        ->assertSee('data-vite="resources/css/themes/light.css"', false);
});

it('refuses a theme that does not exist', function (string $theme) {
    $this->asUser();
    auth()->user()->update(['theme' => 'dark']);

    $this->patch(route('settings.appearance.update'), ['theme' => $theme])
        ->assertSessionHasErrors('theme');

    expect(auth()->user()->fresh()->theme)->toBe('dark');
})->with(['nope', '../app', 'light', 'future']);

it('uses the light theme when the saved theme no longer exists', function () {
    $this->asUser();
    auth()->user()->update(['theme' => 'retired']);

    $this->get(route('settings.appearance'))
        ->assertOk()
        ->assertSee('data-vite="resources/css/themes/light.css"', false)
        ->assertDontSee('themes/retired', false);
});

it('previews a theme from the address bar', function () {
    $this->asUser();

    $this->get(route('settings.appearance', ['_theme' => 'chronicle']))
        ->assertSee('data-vite="resources/css/themes/chronicle.css"', false);
    $this->get(route('settings.appearance', ['_theme' => '../app']))
        ->assertSee('data-vite="resources/css/themes/light.css"', false)
        ->assertDontSee('themes/../app', false);
});

it('offers the chronicle theme in the appearance settings', function () {
    $this->asUser();

    $this->get(route('settings.appearance'))
        ->assertOk()
        ->assertSee('name="theme"', false)
        ->assertSee('value="chronicle"', false)
        ->assertSee(__('profiles.theme.themes.chronicle'));
});
