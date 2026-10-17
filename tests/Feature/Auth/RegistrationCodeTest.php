<?php

use App\Models\User;
use Illuminate\Support\Facades\Config;
use Laravel\Socialite\Facades\Socialite;
use Laravel\Socialite\Two\User as SocialiteUser;

beforeEach(function () {
    Config::set('auth.register_enabled', true);
});

function registrationData(array $extra = []): array
{
    return array_merge([
        'name' => 'Tanis Test',
        'email' => 'tanis@kanka.test',
        'password' => 'disposable-password',
    ], $extra);
}

it('does not ask for an invite code by default', function () {
    Config::set('auth.register_code', null);

    $this->get(route('register'))
        ->assertOk()
        ->assertDontSee('name="registration_code"', false);

    $this->post(route('register'), registrationData())
        ->assertSessionDoesntHaveErrors('registration_code');
});

it('asks for the invite code when one is set', function () {
    Config::set('auth.register_code', 'solace-inn');

    $this->get(route('register'))
        ->assertOk()
        ->assertSee('name="registration_code"', false)
        // The code itself is never sent to the browser
        ->assertDontSee('solace-inn');
});

it('refuses sign-up without the invite code', function () {
    Config::set('auth.register_code', 'solace-inn');

    $this->post(route('register'), registrationData())
        ->assertSessionHasErrors('registration_code');

    expect(User::where('email', 'tanis@kanka.test')->exists())->toBeFalse();
});

it('refuses sign-up with a wrong invite code', function () {
    Config::set('auth.register_code', 'solace-inn');

    $this->post(route('register'), registrationData(['registration_code' => 'solace-in']))
        ->assertSessionHasErrors('registration_code');

    expect(User::where('email', 'tanis@kanka.test')->exists())->toBeFalse();
});

it('accepts the right invite code', function () {
    Config::set('auth.register_code', 'solace-inn');

    // Other fields may still fail (the email check looks up DNS), but not the code
    $this->post(route('register'), registrationData(['registration_code' => ' solace-inn ']))
        ->assertSessionDoesntHaveErrors('registration_code');
});

it('throttles invite code guesses', function () {
    Config::set('auth.register_code', 'solace-inn');

    foreach (range(1, 6) as $attempt) {
        $this->post(route('register'), registrationData(['registration_code' => "guess-{$attempt}"]))
            ->assertSessionHasErrors('registration_code');
    }
    $this->post(route('register'), registrationData(['registration_code' => 'guess-7']))
        ->assertStatus(429);
});

it('refuses new social accounts while an invite code is required', function () {
    Config::set('app.debug', true);
    Config::set('auth.register_code', 'solace-inn');
    Socialite::fake('google', (new SocialiteUser)->map([
        'id' => 'debug_google_user',
        'name' => 'Debug Google User',
        'email' => 'debug+google@kanka.io',
    ]));

    $this->get('/debug/auth/google')
        ->assertRedirect(route('register'));

    $this->assertGuest();
    $this->assertDatabaseMissing('users', ['email' => 'debug+google@kanka.io']);
});

it('still logs in existing social accounts while an invite code is required', function () {
    Config::set('app.debug', true);
    Config::set('auth.register_code', 'solace-inn');
    $user = User::factory()->create([
        'email' => 'debug+google@kanka.io',
        'provider' => 'google',
        'provider_id' => 'debug_google_user',
    ]);

    $this->get('/debug/auth/google')
        ->assertRedirect(route('home'));

    $this->assertAuthenticatedAs($user);
});
