<?php

namespace App\Services\Entrance;

use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Cookie;

/**
 * The shared entrance password and the grant cookie that proves a visitor entered it.
 * The state (a password hash, a random version and a timestamp) lives in a small JSON file.
 */
class EntranceService
{
    public function isConfigured(): bool
    {
        return ! empty($this->read()['hash']);
    }

    public function setPassword(string $plain): void
    {
        $this->write([
            'hash' => Hash::make($plain),
            'version' => Str::random(40),
            'updated_at' => Carbon::now()->toIso8601String(),
        ]);
    }

    public function clear(): void
    {
        $path = $this->path();
        if (is_file($path)) {
            @unlink($path);
        }
    }

    public function check(string $plain): bool
    {
        $data = $this->read();
        if (empty($data['hash'])) {
            return false;
        }
        if (! Hash::check($plain, $data['hash'])) {
            return false;
        }
        if (Hash::needsRehash($data['hash'])) {
            $data['hash'] = Hash::make($plain);
            $this->write($data);
        }

        return true;
    }

    public function version(): ?string
    {
        $version = $this->read()['version'] ?? null;

        return is_string($version) && $version !== '' ? $version : null;
    }

    public function updatedAt(): ?Carbon
    {
        $at = $this->read()['updated_at'] ?? null;
        if (! is_string($at)) {
            return null;
        }
        try {
            return Carbon::parse($at);
        } catch (\Throwable) {
            return null;
        }
    }

    public function grantCookie(): Cookie
    {
        $days = max(1, (int) config('entrance.remember_days'));
        $value = json_encode([
            'v' => $this->version(),
            'exp' => Carbon::now()->addDays($days)->getTimestamp(),
        ]);
        $secure = config('session.secure');
        if ($secure === null) {
            $secure = request()->isSecure();
        }

        return cookie(
            (string) config('entrance.cookie'),
            $value,
            $days * 24 * 60,
            '/',
            null,
            (bool) $secure,
            true,
            false,
            'lax'
        );
    }

    public function forgetCookie(): Cookie
    {
        return cookie()->forget((string) config('entrance.cookie'));
    }

    public function hasValidGrant(Request $request): bool
    {
        $version = $this->version();
        if ($version === null) {
            return false;
        }
        $raw = $request->cookies->get((string) config('entrance.cookie'));
        if (! is_string($raw) || $raw === '') {
            return false;
        }
        $grant = json_decode($raw, true);
        if (! is_array($grant) || ! is_string($grant['v'] ?? null) || ! is_int($grant['exp'] ?? null)) {
            return false;
        }

        return hash_equals($version, $grant['v']) && $grant['exp'] > Carbon::now()->getTimestamp();
    }

    protected function path(): string
    {
        return (string) config('entrance.store');
    }

    protected function read(): array
    {
        // Never cached: a change made from the CLI or another request applies immediately.
        $path = $this->path();
        $data = [];
        if (is_file($path)) {
            $decoded = json_decode((string) file_get_contents($path), true);
            if (is_array($decoded)) {
                $data = $decoded;
            }
        }

        return $data;
    }

    protected function write(array $data): void
    {
        $path = $this->path();
        $dir = dirname($path);
        if (! is_dir($dir)) {
            mkdir($dir, 0700, true);
        }
        $tmp = tempnam($dir, 'ent');
        chmod($tmp, 0600);
        file_put_contents($tmp, json_encode($data, JSON_PRETTY_PRINT));
        rename($tmp, $path);
        @chmod($path, 0600);
    }
}
