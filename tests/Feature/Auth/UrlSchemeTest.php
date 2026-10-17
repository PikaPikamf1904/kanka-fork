<?php

use App\Models\User;
use App\Providers\AppServiceProvider;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\URL;

// A production install on a home network is served over plain HTTP. Forms and redirects
// must stay on http:// there, or signing in and registering go nowhere.

function applyUrlScheme(string $url, bool $forceHttps): void
{
    app()['env'] = 'production';
    Config::set('app.url', $url);
    Config::set('app.force_https', $forceHttps);
    URL::forceScheme(null);
    app()->getProvider(AppServiceProvider::class)->forceHttpsUrlsWhenConfigured();
}

afterEach(function () {
    URL::forceScheme(null);
    app()['env'] = 'testing';
});

it('keeps plain-HTTP production forms and redirects on http', function () {
    applyUrlScheme('http://192.168.1.10', false);
    Config::set('auth.register_enabled', true);
    expect(app()->isProduction())->toBeTrue();

    $this->get('http://192.168.1.10/login')
        ->assertOk()
        ->assertSee('action="http://192.168.1.10/login"', false)
        ->assertDontSee('action="https://', false);
    $this->get('http://192.168.1.10/register')
        ->assertOk()
        ->assertSee('action="http://192.168.1.10/register"', false);

    $user = User::factory()->create(['password' => bcrypt('disposable-password')]);
    $response = $this->post('http://192.168.1.10/login', ['email' => $user->email, 'password' => 'disposable-password']);
    $response->assertRedirect();
    expect($response->headers->get('Location'))->toStartWith('http://192.168.1.10');
});

it('uses https when the site address is https', function () {
    applyUrlScheme('https://wiki.example.ts.net', false);

    $this->get('http://wiki.example.ts.net/login')
        ->assertOk()
        ->assertSee('action="https://wiki.example.ts.net/login"', false);
});

it('uses https when APP_FORCE_HTTPS is on', function () {
    applyUrlScheme('http://192.168.1.10', true);

    expect(url('/login'))->toStartWith('https://');
});
