<?php

use App\Models\User;
use Illuminate\Support\Facades\Hash;

it('creates a user with a password typed at the prompt', function () {
    $this->artisan('users:create', ['email' => 'laurana@kanka.test', 'name' => 'Laurana'])
        ->expectsQuestion('Password (at least 8 characters)', 'disposable-password')
        ->expectsQuestion('Password again', 'disposable-password')
        ->expectsOutputToContain('(laurana@kanka.test). They can log in now.')
        ->doesntExpectOutputToContain('disposable-password')
        ->assertSuccessful();

    $user = User::where('email', 'laurana@kanka.test')->first();
    expect($user)->not->toBeNull()
        ->and($user->name)->toBe('Laurana')
        ->and(Hash::check('disposable-password', $user->password))->toBeTrue();
});

it('refuses an email that is already registered', function () {
    User::factory()->create(['email' => 'laurana@kanka.test']);

    $this->artisan('users:create', ['email' => 'laurana@kanka.test', 'name' => 'Laurana'])
        ->assertFailed();

    expect(User::where('email', 'laurana@kanka.test')->count())->toBe(1);
});

it('refuses an invalid email', function () {
    $this->artisan('users:create', ['email' => 'not-an-email', 'name' => 'Laurana'])
        ->assertFailed();
});

it('refuses passwords that do not match', function () {
    $this->artisan('users:create', ['email' => 'laurana@kanka.test', 'name' => 'Laurana'])
        ->expectsQuestion('Password (at least 8 characters)', 'disposable-password')
        ->expectsQuestion('Password again', 'different-password')
        ->expectsOutput('The passwords do not match.')
        ->assertFailed();

    expect(User::where('email', 'laurana@kanka.test')->exists())->toBeFalse();
});

it('refuses a short password', function () {
    $this->artisan('users:create', ['email' => 'laurana@kanka.test', 'name' => 'Laurana'])
        ->expectsQuestion('Password (at least 8 characters)', 'short')
        ->assertFailed();

    expect(User::where('email', 'laurana@kanka.test')->exists())->toBeFalse();
});

it('refuses to run without a terminal', function () {
    $this->artisan('users:create', ['email' => 'laurana@kanka.test', 'name' => 'Laurana', '--no-interaction' => true])
        ->assertFailed();

    expect(User::where('email', 'laurana@kanka.test')->exists())->toBeFalse();
});
