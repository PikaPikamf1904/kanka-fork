<?php

/*
 * Helpers for the entrance tests. Not a test file itself: loaded with require_once.
 */

use App\Services\Entrance\EntranceService;
use Illuminate\Support\Facades\Config;

if (! defined('ENTRANCE_TEST_SECRET')) {
    define('ENTRANCE_TEST_SECRET', 'correct horse test value');
}

/** Turn the entrance on with a throw-away store and (optionally) a password. */
function entranceBoot(bool $withPassword = true): EntranceService
{
    $dir = sys_get_temp_dir() . '/entrance-test-' . bin2hex(random_bytes(6));
    $GLOBALS['entrance_test_dir'] = $dir;
    Config::set('entrance.enabled', true);
    Config::set('entrance.store', $dir . '/entrance.json');

    $service = app(EntranceService::class);
    if ($withPassword) {
        $service->setPassword(ENTRANCE_TEST_SECRET);
    }

    return $service;
}

function entranceCleanup(): void
{
    $dir = $GLOBALS['entrance_test_dir'] ?? null;
    if ($dir && is_dir($dir)) {
        foreach (glob($dir . '/*') ?: [] as $file) {
            @unlink($file);
        }
        @rmdir($dir);
    }
    unset($GLOBALS['entrance_test_dir']);
}

/** The grant cookie value from a response, or null. */
function entranceGrantCookie($response): ?string
{
    foreach ($response->headers->getCookies() as $cookie) {
        if ($cookie->getName() === config('entrance.cookie') && $cookie->getValue()) {
            return $cookie->getValue();
        }
    }

    return null;
}

/** Make the next request a plain logged-out one. */
function entranceAsGuest(): void
{
    app('auth')->forgetGuards();
}

/** A decrypted grant cookie payload, as the app sees it after EncryptCookies. */
function entranceGrantPayload(EntranceService $service, int $ttl = 3600): string
{
    return json_encode(['v' => $service->version(), 'exp' => time() + $ttl]);
}
