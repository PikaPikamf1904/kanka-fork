<?php

use App\Services\Entrance\EntranceService;
use Illuminate\Support\Facades\Config;

require_once __DIR__ . '/support.php';

afterEach(fn () => entranceCleanup());

it('sets the password from the command line', function () {
    entranceBoot(false);
    $this->artisan('entrance:password')
        ->expectsQuestion('New entrance password', ENTRANCE_TEST_SECRET)
        ->expectsQuestion('Repeat the password', ENTRANCE_TEST_SECRET)
        ->expectsOutput('Entrance password updated. Everyone who had entered must enter again.')
        ->doesntExpectOutputToContain(ENTRANCE_TEST_SECRET)
        ->assertExitCode(0);

    expect(app(EntranceService::class)->check(ENTRANCE_TEST_SECRET))->toBeTrue();
});

it('refuses mismatching or short passwords and never prints them', function () {
    entranceBoot(false);
    $this->artisan('entrance:password')
        ->expectsQuestion('New entrance password', ENTRANCE_TEST_SECRET)
        ->expectsQuestion('Repeat the password', 'different fake value!')
        ->doesntExpectOutputToContain(ENTRANCE_TEST_SECRET)
        ->assertExitCode(1);
    $this->artisan('entrance:password')
        ->expectsQuestion('New entrance password', 'short')
        ->expectsQuestion('Repeat the password', 'short')
        ->assertExitCode(1);

    expect(app(EntranceService::class)->isConfigured())->toBeFalse();
});

it('clears the password and reports status without secrets', function () {
    $service = entranceBoot();
    $this->artisan('entrance:status')
        ->expectsOutputToContain('Password set: yes')
        ->doesntExpectOutputToContain($service->version())
        ->assertExitCode(0);
    $this->artisan('entrance:password', ['--clear' => true])
        ->expectsOutputToContain('closed to visitors')
        ->assertExitCode(0);
    expect(app(EntranceService::class)->isConfigured())->toBeFalse();
});

it('keeps the settings page behind login', function () {
    entranceBoot();
    $this->get(route('settings.entrance'))->assertRedirect();
    $this->post(route('settings.entrance.update'), ['password' => 'x'])->assertRedirect();
});

it('hides the settings page from accounts that are not managers', function () {
    entranceBoot();
    $this->asUser();
    Config::set('entrance.managers', []);
    $session = ['auth.password_confirmed_at' => time()];
    $this->withSession($session)->get(route('settings.entrance'))->assertNotFound();
    $this->withSession($session)
        ->post(route('settings.entrance.update'), ['password' => 'a long fake value', 'password_confirmation' => 'a long fake value'])
        ->assertNotFound();
    expect(app(EntranceService::class)->check('a long fake value'))->toBeFalse();
});

it('lets a manager change the password', function () {
    $service = entranceBoot();
    $this->asUser();
    Config::set('entrance.managers', [auth()->id()]);
    $session = ['auth.password_confirmed_at' => time()];

    $old = $service->version();
    $page = $this->withSession($session)->get(route('settings.entrance'))->assertOk();
    $page->assertDontSee($old, false);
    expect($page->getContent())->not->toContain('$2y$');

    $this->withSession($session)->post(route('settings.entrance.update'), [
        'password' => 'brand new fake value',
        'password_confirmation' => 'brand new fake value',
    ])->assertRedirect(route('settings.entrance'));
    expect(app(EntranceService::class)->check('brand new fake value'))->toBeTrue()
        ->and(app(EntranceService::class)->version())->not->toBe($old);
});

it('validates length and confirmation', function () {
    entranceBoot();
    $this->asUser();
    Config::set('entrance.managers', [auth()->id()]);
    $session = ['auth.password_confirmed_at' => time()];

    $this->withSession($session)->post(route('settings.entrance.update'), ['password' => 'short', 'password_confirmation' => 'short'])
        ->assertSessionHasErrors('password');
    $this->withSession($session)->post(route('settings.entrance.update'), ['password' => 'a long fake value', 'password_confirmation' => 'a long fake VALUE'])
        ->assertSessionHasErrors('password');
    expect(app(EntranceService::class)->check('a long fake value'))->toBeFalse();
});
