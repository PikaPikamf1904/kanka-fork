<?php

use App\Http\Middleware\ReplicationSwitcher;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

function runReplicationSwitcher(string $path): string
{
    $default = DB::getDefaultConnection();

    try {
        (new ReplicationSwitcher)->handle(Request::create($path), fn () => response('ok'));

        return DB::getDefaultConnection();
    } finally {
        DB::setDefaultConnection($default);
    }
}

it('sends guest requests to the replica when enabled', function () {
    config(['database.replica_enabled' => true]);

    expect(runReplicationSwitcher('/w/1'))->toBe('replica');
});

it('keeps the login route on the primary connection when enabled', function () {
    config(['database.replica_enabled' => true]);

    expect(runReplicationSwitcher('/login'))->toBe(DB::getDefaultConnection());
});

it('keeps guest requests on the default connection when disabled', function () {
    config(['database.replica_enabled' => false]);

    expect(runReplicationSwitcher('/w/1'))->toBe(DB::getDefaultConnection());
});

it('serves guest web requests from the test database', function () {
    $this->get('/')->assertRedirect();

    expect(DB::getDefaultConnection())->toBe('sqlite');
});
