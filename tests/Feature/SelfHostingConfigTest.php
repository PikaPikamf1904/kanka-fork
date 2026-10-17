<?php

use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Support\Facades\Storage;

function scheduledCommands(): string
{
    return collect(app(Schedule::class)->events())
        ->map(fn ($event) => $event->command)
        ->implode("\n");
}

it('schedules kanka.io service tasks by default', function () {
    config(['app.saas_schedule' => true]);

    expect(scheduledCommands())
        ->toContain('emails:onboarding')
        ->toContain('subscriptions:end')
        ->toContain('report:weekly')
        ->toContain('calendar:advance');
});

it('skips kanka.io service tasks when disabled', function () {
    config(['app.saas_schedule' => false]);

    expect(scheduledCommands())
        ->not->toContain('emails:onboarding')
        ->not->toContain('subscriptions:end')
        ->not->toContain('report:weekly')
        ->toContain('calendar:advance')
        ->toContain('backup:run');
});

it('only anonymises user logs when the logs database is enabled', function (bool $enabled) {
    config(['logging.enabled' => $enabled]);

    expect(str_contains(scheduledCommands(), 'cleanup:anonymise-user-logs'))->toBe($enabled);
})->with([true, false]);

function configWithEnv(string $file, string $key, ?string $value): array
{
    $previous = [$_ENV[$key] ?? null, $_SERVER[$key] ?? null];
    $_ENV[$key] = $_SERVER[$key] = $value;

    try {
        return require base_path("config/{$file}.php");
    } finally {
        [$_ENV[$key], $_SERVER[$key]] = $previous;
    }
}

function filesystemsConfig(?string $driver): array
{
    return configWithEnv('filesystems', 'S3_DISK_DRIVER', $driver);
}

it('backs up uploads only when enabled', function (?string $value, bool $included) {
    $include = configWithEnv('backup', 'BACKUP_INCLUDE_UPLOADS', $value)['backup']['source']['files']['include'];

    expect($include)->toBe($included ? [storage_path('app/public')] : []);
})->with([
    'default' => [null, false],
    'enabled' => ['true', true],
]);

it('prunes log models only when the logs database is enabled', function (bool $enabled) {
    config(['logging.enabled' => $enabled]);

    $prune = collect(app(Schedule::class)->events())
        ->first(fn ($event) => str_contains($event->command, 'model:prune'))
        ->command;

    expect(str_contains($prune, '--except'))->toBe(! $enabled);
    if (! $enabled) {
        expect($prune)->toContain('UserLog')->toContain('ApiLog');
    }
})->with([true, false]);

it('keeps object storage disks on S3 by default', function () {
    $disks = filesystemsConfig(null)['disks'];

    expect($disks['s3']['driver'])->toBe('s3')
        ->and($disks['export']['driver'])->toBe('s3');
});

it('serves local import uploads only through signed URLs', function () {
    $disk = filesystemsConfig('local')['disks']['export'];

    expect($disk['driver'])->toBe('local')
        ->and($disk['visibility'])->toBe('private')
        ->and($disk['serve'])->toBeTrue()
        ->and(str_starts_with($disk['root'], storage_path('app/public')))->toBeFalse();
});

it('stores the s3 disk locally outside the web root when configured', function () {
    $disk = filesystemsConfig('local')['disks']['s3'];

    expect($disk['driver'])->toBe('local')
        ->and($disk['root'])->toBe(storage_path('app/s3'))
        ->and($disk)->not->toHaveKey('url')
        ->and(str_starts_with($disk['root'], storage_path('app/public')))->toBeFalse();

    config(['filesystems.disks.s3' => $disk]);
    Storage::forgetDisk('s3');
    Storage::disk('s3')->put('exports/1/test.zip', 'zip');

    expect(Storage::disk('s3')->exists('exports/1/test.zip'))->toBeTrue();
    Storage::disk('s3')->deleteDirectory('exports/1');
});
