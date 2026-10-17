<?php

use App\Models\User;
use Illuminate\Auth\Notifications\ResetPassword;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Notification;

/**
 * The "log in as any user" list, the fake social login and the password reset form are
 * reachable without an account, so they must stay closed on a real wiki.
 */
it('keeps the login-as shortcuts off by default', function () {
    Config::set('auth.user_list', false);
    $user = User::factory()->create(['name' => 'Raistlin Test']);

    $this->get(route('login-as-user', $user))->assertRedirect(route('login'));
    $this->get(route('login-as', ['user' => $user->id]))->assertRedirect(route('login'));
    $this->assertGuest();

    $this->get(route('login'))
        ->assertOk()
        ->assertDontSee('Raistlin Test');
});

it('still lets developers use the login-as shortcuts outside production', function () {
    Config::set('auth.user_list', true);
    $user = User::factory()->create();

    $this->get(route('login-as-user', $user));

    $this->assertAuthenticatedAs($user);
});

it('refuses the login-as shortcuts in production even when turned on', function () {
    Config::set('auth.user_list', true);
    $this->app->detectEnvironment(fn () => 'production');
    $user = User::factory()->create(['name' => 'Raistlin Test']);

    $this->get(route('login-as-user', $user))->assertRedirect(route('login'));
    $this->get(route('login-as', ['user' => $user->id]))->assertRedirect(route('login'));
    $this->assertGuest();

    $this->get(route('login'))
        ->assertOk()
        ->assertDontSee('Raistlin Test')
        ->assertDontSee(route('login-as-user', $user));
});

it('escapes names in the login-as list', function () {
    Config::set('auth.user_list', true);
    $user = User::factory()->create();
    // Saving through the model strips tags; the page must not rely on that
    DB::table('users')->where('id', $user->id)->update(['name' => '<b>Kitiara</b>']);

    $this->get(route('login'))
        ->assertOk()
        ->assertSee('&lt;b&gt;Kitiara&lt;/b&gt;', false)
        ->assertDontSee('<b>Kitiara</b>', false);
});

it('answers 404 for an unknown user in the login-as form', function () {
    Config::set('auth.user_list', true);

    $this->get(route('login-as', ['user' => 999999]))->assertNotFound();
    $this->assertGuest();
});

it('hides the fake social login unless debug mode is on', function () {
    Config::set('app.debug', false);

    $this->get(route('debug.auth.provider', ['provider' => 'google']))->assertNotFound();

    expect(User::where('email', 'debug+google@kanka.io')->exists())->toBeFalse();
    $this->assertGuest();
});

it('locks out password guessing after five tries', function () {
    $user = User::factory()->create([
        'email' => 'tasslehoff@kanka.test',
        'password' => Hash::make('right-password'),
    ]);

    foreach (range(1, 5) as $try) {
        $this->postJson(route('login'), ['email' => $user->email, 'password' => 'wrong-password'])
            ->assertStatus(422);
    }
    // Even the right password is refused until the lockout ends
    $this->postJson(route('login'), ['email' => $user->email, 'password' => 'right-password'])
        ->assertStatus(429);

    $this->assertGuest();
});

it('sends at most one password reset email a minute per account', function () {
    Notification::fake();
    $user = User::factory()->create(['email' => 'tika@kanka.test']);

    $this->post(route('password.email'), ['email' => $user->email])->assertSessionHasNoErrors();
    $this->post(route('password.email'), ['email' => $user->email])->assertSessionHasErrors('email');

    Notification::assertSentToTimes($user, ResetPassword::class, 1);
});

it('rate limits the password reset form', function () {
    Notification::fake();

    foreach (range(1, 6) as $try) {
        $this->post(route('password.email'), ['email' => "nobody{$try}@kanka.test"])
            ->assertStatus(302);
    }

    $this->post(route('password.email'), ['email' => 'nobody7@kanka.test'])->assertStatus(429);
});
