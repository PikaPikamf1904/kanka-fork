<?php

use App\Enums\CampaignVisibility;
use App\Http\Middleware\EncryptCookies;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Route;

require_once __DIR__ . '/support.php';

afterEach(fn () => entranceCleanup());

it('leaves guest requests alone while the entrance is disabled', function () {
    Config::set('entrance.enabled', false);
    $this->get('/')->assertRedirect(route('login'));
    $this->get(route('login'))->assertOk();
});

it('is off by default', function () {
    expect(config('entrance.enabled'))->toBeFalse()
        ->and(config('entrance.min_length'))->toBe(10)
        ->and(config('entrance.cookie'))->toBe('chronicle_entrance');
});

it('sends guests to the entrance and remembers where they were going', function () {
    entranceBoot();
    $this->asUser()->withCampaign(['visibility_id' => CampaignVisibility::public]);
    entranceAsGuest();

    $this->get('/')->assertRedirect(route('entrance.show'))
        ->assertHeader('X-Robots-Tag', 'noindex');
    $this->get(route('dashboard', 1))->assertRedirect(route('entrance.show'));
    expect(session('url.intended'))->toContain('/w/1');

    if (Route::has('register')) {
        $this->get(route('register'))->assertRedirect(route('entrance.show'));
    }
});

it('answers JSON requests with 401 and nothing else', function () {
    entranceBoot();
    $this->getJson('/')->assertStatus(401)->assertExactJson(['message' => 'Entrance required.']);
});

it('serves a minimal entrance page with a single password field', function () {
    entranceBoot();
    $html = $this->get(route('entrance.show'))->assertOk()->getContent();

    expect(substr_count($html, 'type="password"'))->toBe(1)
        ->and($html)->toContain('name="password"')
        ->and($html)->toContain('autocomplete="current-password"')
        ->and($html)->toContain('>Enter</button>')
        ->and($html)->toContain('noindex,nofollow')
        ->and($html)->toContain('lang="en"')
        ->and($html)->not->toContain('type="email"')
        ->and($html)->not->toContain('name="email"')
        ->and($html)->not->toContain('name="username"')
        ->and(strtolower($html))->not->toContain('register')
        ->and(strtolower($html))->not->toContain('forgot');
});

it('fails closed and says so when no password has been set', function () {
    entranceBoot(false);
    $this->get(route('entrance.show'))->assertOk()
        ->assertSee('The entrance hasn&#039;t been set up yet.', false)
        ->assertSee('disabled', false);

    $response = $this->from(route('entrance.show'))
        ->post(route('entrance.enter'), ['password' => ENTRANCE_TEST_SECRET])
        ->assertRedirect(route('entrance.show'))
        ->assertSessionHasErrors('password');
    expect(entranceGrantCookie($response))->toBeNull();
    $this->get('/')->assertRedirect(route('entrance.show'));
});

it('rejects a wrong password without leaking it', function () {
    entranceBoot();
    Log::spy();

    $response = $this->from(route('entrance.show'))
        ->post(route('entrance.enter'), ['password' => 'wrong guess value'])
        ->assertRedirect(route('entrance.show'))
        ->assertSessionHasErrors('password');

    expect(entranceGrantCookie($response))->toBeNull()
        ->and(session()->getOldInput('password'))->toBeNull();
    Log::shouldHaveReceived('warning')->withArgs(
        fn ($message, $context = []) => $message === 'Failed entrance attempt' && ! str_contains(json_encode($context), 'wrong guess')
    );
});

it('lets the right password in, back to where the visitor was going, with an encrypted cookie', function () {
    $service = entranceBoot();

    $this->get(route('dashboard', 1))->assertRedirect(route('entrance.show'));
    $response = $this->post(route('entrance.enter'), ['password' => ENTRANCE_TEST_SECRET]);
    $response->assertRedirect(url('/w/1'));

    $cookie = entranceGrantCookie($response);
    expect($cookie)->not->toBeNull();
    // Laravel encrypts it: the raw value is not the readable JSON.
    expect(json_decode($cookie, true))->toBeNull();
    $middleware = new class(app('encrypter')) extends EncryptCookies
    {
        public function isDisabledFor(string $name): bool
        {
            return $this->isDisabled($name);
        }
    };
    expect($middleware->isDisabledFor(config('entrance.cookie')))->toBeFalse();

    // Presented again, the (decrypted) cookie passes the gate.
    $this->withCookie(config('entrance.cookie'), entranceGrantPayload($service))
        ->get(route('entrance.show'))->assertRedirect('/');
});

it('accepts the cookie exactly as the server issued it', function () {
    entranceBoot();
    $response = $this->post(route('entrance.enter'), ['password' => ENTRANCE_TEST_SECRET]);
    $issued = collect($response->headers->getCookies())->first(fn ($c) => $c->getName() === config('entrance.cookie'));

    expect($issued->isHttpOnly())->toBeTrue()
        ->and($issued->getSameSite())->toBe('lax')
        ->and($issued->getPath())->toBe('/');

    $this->withUnencryptedCookie(config('entrance.cookie'), $issued->getValue())
        ->get(route('entrance.show'))->assertRedirect('/');
});

it('throttles after five failed attempts, even for the right password', function () {
    entranceBoot();
    foreach (range(1, 5) as $i) {
        $this->post(route('entrance.enter'), ['password' => 'nope nope nope ' . $i])->assertSessionHasErrors('password');
    }
    $response = $this->post(route('entrance.enter'), ['password' => ENTRANCE_TEST_SECRET]);
    $response->assertStatus(429)->assertSee('Too many attempts', false);
    expect(entranceGrantCookie($response))->toBeNull();
});

it('invalidates old cookies when the password changes', function () {
    $service = entranceBoot();
    $payload = entranceGrantPayload($service);
    $this->withCookie(config('entrance.cookie'), $payload)->get(route('entrance.show'))->assertRedirect('/');

    $service->setPassword('another fake value 123');
    $this->withCookie(config('entrance.cookie'), $payload)->get(route('entrance.show'))->assertOk();
});

it('rejects expired, tampered and garbage cookies', function () {
    $service = entranceBoot();
    $name = config('entrance.cookie');
    $request = fn (string $value) => Request::create('/', 'GET', [], [$name => $value]);

    expect($service->hasValidGrant($request(json_encode(['v' => $service->version(), 'exp' => time() + 60]))))->toBeTrue()
        ->and($service->hasValidGrant($request(json_encode(['v' => $service->version(), 'exp' => time() - 1]))))->toBeFalse()
        ->and($service->hasValidGrant($request(json_encode(['v' => 'x' . $service->version(), 'exp' => time() + 60]))))->toBeFalse()
        ->and($service->hasValidGrant($request(json_encode(['v' => $service->version()]))))->toBeFalse()
        ->and($service->hasValidGrant($request(json_encode(['v' => [1], 'exp' => time() + 60]))))->toBeFalse()
        ->and($service->hasValidGrant($request('not json')))->toBeFalse()
        ->and($service->hasValidGrant($request('')))->toBeFalse()
        ->and($service->hasValidGrant(Request::create('/')))->toBeFalse();

    // Over HTTP: garbage never encrypted by the server does not pass either.
    $this->withUnencryptedCookie($name, 'garbage')->get('/')->assertRedirect(route('entrance.show'));
    $this->withCookie($name, 'garbage')->get('/')->assertRedirect(route('entrance.show'));
});

it('rejects a cookie after it expires', function () {
    $service = entranceBoot();
    $payload = entranceGrantPayload($service, 86400);
    $this->travel(2)->days();
    $this->withCookie(config('entrance.cookie'), $payload)->get(route('entrance.show'))->assertOk();
});

it('keeps login, password reset and health reachable without a grant', function () {
    entranceBoot();
    $this->get(route('login'))->assertOk();
    $this->get(route('password.request'))->assertOk();
    $this->get('/up')->assertStatus(200);
});

it('lets logged-in users through', function () {
    entranceBoot();
    $this->asUser();
    expect($this->get('/')->headers->get('Location'))->not->toContain('/entrance');
    $this->get(route('entrance.show'))->assertRedirect('/');
});

it('stores a hash, never the password', function () {
    $service = entranceBoot();
    $path = config('entrance.store');
    $raw = file_get_contents($path);
    $data = json_decode($raw, true);

    expect($raw)->not->toContain(ENTRANCE_TEST_SECRET)
        ->and(password_get_info($data['hash'])['algo'])->not->toBeNull()
        ->and($data['version'])->toHaveLength(40)
        ->and($service->check(ENTRANCE_TEST_SECRET))->toBeTrue()
        ->and($service->check('something else entirely'))->toBeFalse();
    if (DIRECTORY_SEPARATOR === '/') {
        expect(substr(sprintf('%o', fileperms($path)), -4))->toBe('0600')
            ->and(substr(sprintf('%o', fileperms(dirname($path))), -4))->toBe('0700');
    }

    $service->clear();
    expect($service->isConfigured())->toBeFalse()->and($service->check(ENTRANCE_TEST_SECRET))->toBeFalse();
});

it('forgets the grant on leave', function () {
    entranceBoot();
    $response = $this->post(route('entrance.leave'))->assertRedirect(route('entrance.show'));
    $cookie = collect($response->headers->getCookies())->first(fn ($c) => $c->getName() === config('entrance.cookie'));
    expect($cookie)->not->toBeNull()->and($cookie->getExpiresTime())->toBeLessThan(time());
});

it('closes the public discovery API while the entrance is on', function () {
    Config::set('entrance.enabled', false);
    expect($this->getJson('/api/public/campaigns')->status())->not->toBe(404);

    entranceBoot();
    $this->getJson('/api/public/campaigns')->assertNotFound();
    $this->getJson('/api/public/showcase')->assertNotFound();
});
