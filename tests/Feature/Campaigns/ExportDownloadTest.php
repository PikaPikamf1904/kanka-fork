<?php

use App\Enums\CampaignExportStatus;
use App\Enums\CampaignVisibility;
use App\Jobs\Campaigns\Export;
use App\Jobs\FileCleanup;
use App\Livewire\Campaigns\ExportsTable;
use App\Models\Campaign;
use App\Models\CampaignExport;
use App\Models\CampaignRoleUser;
use App\Models\CampaignUser;
use App\Models\Character;
use App\Models\User;
use App\Services\Campaign\Exports\QueueService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Laravel\Passport\Passport;

/**
 * A finished export row with a synthetic archive on the (faked) s3 disk.
 */
function exportDownloadFixture(int $campaignId = 1, array $extra = [], bool $withFile = true): CampaignExport
{
    $path = $extra['path'] ?? 'exports/' . $campaignId . '/test-campaign_20261016_120000.zip';
    if ($withFile) {
        Storage::disk('s3')->put($path, 'synthetic-zip-' . $campaignId, 'private');
    }

    return CampaignExport::withoutEvents(fn () => CampaignExport::create($extra + [
        'campaign_id' => $campaignId,
        'created_by' => 1,
        'type' => 1,
        'size' => 0,
        'status' => CampaignExportStatus::finished,
        'path' => $path,
    ]));
}

/**
 * Some campaign policy checks keep a per-process cache keyed by user id, so these users get
 * ids no other test uses.
 */
function exportDownloadUser(int $id, int $campaignId, int $roleId): User
{
    $user = User::factory()->create(['id' => $id]);
    CampaignUser::create(['campaign_id' => $campaignId, 'user_id' => $user->id]);
    CampaignRoleUser::create(['campaign_role_id' => $roleId, 'user_id' => $user->id]);

    return $user;
}

it('lets the campaign owner download a finished export', function () {
    $this->asUser()->withCampaign();
    $export = exportDownloadFixture();

    $response = $this->get(route('campaign.export-download', [1, $export]))
        ->assertOk()
        ->assertDownload('test-campaign_20261016_120000.zip');

    expect($response->headers->get('Cache-Control'))->toContain('no-store')
        ->and($response->streamedContent())->toBe('synthetic-zip-1');
});

it('lets another admin of the campaign download it', function () {
    $this->asUser()->withCampaign();
    $export = exportDownloadFixture();
    Passport::actingAs(exportDownloadUser(7101, 1, 1), ['*']);

    $this->get(route('campaign.export-download', [1, $export]))
        ->assertOk()
        ->assertDownload();
});

it('refuses a player of the campaign', function () {
    $this->asUser()->withCampaign();
    $export = exportDownloadFixture();
    $this->asPlayer();

    $this->get(route('campaign.export-download', [1, $export]))
        ->assertForbidden();
});

/**
 * Kanka answers a request for a private campaign you are not in with its "private campaign"
 * page (HTTP 200, by design), so check that no archive comes back.
 */
function assertNoExportServed($response): void
{
    $response->assertHeaderMissing('Content-Disposition');
    expect((string) $response->getContent())->not->toContain('synthetic-zip');
}

it('refuses an admin of a different campaign', function () {
    $this->asUser()->withCampaign()->withCampaigns();
    $export = exportDownloadFixture();
    Passport::actingAs(exportDownloadUser(7102, 2, 4), ['*']);

    $response = $this->get(route('campaign.export-download', [1, $export]))
        ->assertViewIs('errors.private-campaign');
    assertNoExportServed($response);
});

it('refuses a non-member even when the campaign is public', function () {
    $this->asUser()->withCampaign(['visibility_id' => CampaignVisibility::public]);
    $export = exportDownloadFixture();
    Passport::actingAs(User::factory()->create(['id' => 7104]), ['*']);

    assertNoExportServed($this->get(route('campaign.export-download', [1, $export]))
        ->assertForbidden());
});

it('does not serve another campaign\'s export through your own campaign', function () {
    $this->asUser()->withCampaign()->withCampaigns();
    $export = exportDownloadFixture(1);
    Passport::actingAs(exportDownloadUser(7103, 2, 4), ['*']);

    $this->get(route('campaign.export-download', [2, $export]))
        ->assertNotFound();
});

it('sends a logged-out visitor to the login page', function (CampaignVisibility $visibility) {
    $this->asUser()->withCampaign(['visibility_id' => $visibility]);
    $export = exportDownloadFixture();
    $this->app['auth']->forgetGuards();

    $response = $this->get(route('campaign.export-download', [1, $export]))
        ->assertRedirect();
    assertNoExportServed($response);
    expect($response->headers->get('Location'))->toContain('login');
})->with([
    'private campaign' => CampaignVisibility::private,
    'public campaign' => CampaignVisibility::public,
]);

it('returns not found for an unknown export', function () {
    $this->asUser()->withCampaign();

    $this->get(route('campaign.export-download', [1, 999]))
        ->assertNotFound();
});

it('returns not found for exports that are not finished', function (CampaignExportStatus $status) {
    $this->asUser()->withCampaign();
    $export = exportDownloadFixture(1, ['status' => $status]);

    $this->get(route('campaign.export-download', [1, $export]))
        ->assertNotFound();
})->with([
    'scheduled' => CampaignExportStatus::scheduled,
    'running' => CampaignExportStatus::running,
    'failed' => CampaignExportStatus::failed,
]);

it('returns not found when the archive is already gone', function () {
    $this->asUser()->withCampaign();
    $export = exportDownloadFixture(1, [], false);

    $this->get(route('campaign.export-download', [1, $export]))
        ->assertNotFound();
});

it('deletes an expired export instead of serving it', function () {
    $this->asUser()->withCampaign();
    $export = exportDownloadFixture();

    $this->travel((int) config('limits.campaigns.export') + 1)->hours();

    $this->get(route('campaign.export-download', [1, $export]))
        ->assertNotFound();
    Storage::disk('s3')->assertMissing($export->path);
});

it('only serves archives from the campaign\'s own export folder', function (string $path) {
    $this->asUser()->withCampaign();
    Storage::disk('s3')->put($path, 'not-for-download');
    $export = exportDownloadFixture(1, ['path' => $path], false);

    $this->get(route('campaign.export-download', [1, $export]))
        ->assertNotFound();
})->with([
    'another campaign' => 'exports/2/test-campaign_20261016_120000.zip',
    'parent folder' => 'exports/1/../../secret.zip',
    'outside exports' => 'w/1/images/secret.zip',
    'not a zip' => 'exports/1/notes.txt',
]);

it('links to the protected download route and keeps the archive private', function () {
    $this->asUser()->withCampaign();
    $export = exportDownloadFixture();

    $table = new ExportsTable;
    $table->campaign = Campaign::find(1);
    $html = $table->download($export);

    expect($html)->toContain(route('campaign.export-download', [Campaign::find(1), $export]))
        ->not->toContain(Storage::disk('s3')->url($export->path))
        ->and(Storage::disk('s3')->visibility($export->path))->toBe('private');
});

it('stores a real export privately and cleans it up from the same disk', function () {
    config(['queue.default' => 'database']);
    Queue::fake([FileCleanup::class]);
    Notification::fake();
    $this->asUser()->withCampaign();
    Character::factory()->count(3)->create(['campaign_id' => 1]);

    $export = CampaignExport::create([
        'campaign_id' => 1,
        'created_by' => 1,
        'type' => 1,
        // MariaDB fills in 0 (non-strict mode); SQLite needs it spelled out.
        'size' => 0,
        'status' => CampaignExportStatus::scheduled,
    ]);
    (new Export(Campaign::find(1), auth()->user(), $export))->handle();

    $export->refresh();
    expect($export->finished())->toBeTrue()
        ->and($export->storedPath())->toBe($export->path);
    Storage::disk('s3')->assertExists($export->path);
    expect(Storage::disk('s3')->visibility($export->path))->toBe('private');

    $this->get(route('campaign.export-download', [1, $export]))
        ->assertOk()
        ->assertDownload(basename($export->path));

    Queue::assertPushed(FileCleanup::class, function (FileCleanup $job) {
        $job->handle();

        return true;
    });
    Storage::disk('s3')->assertMissing($export->path);
});

it('runs a queued export on the heavy queue worker', function () {
    // The self-hosted setup (deploy/env.production.example): both connections use the
    // database "jobs" table, and kanka-queue-heavy runs "queue:work heavy --queue=heavy".
    config([
        'queue.default' => 'database',
        'queue.connections.heavy' => [
            'driver' => 'database',
            'table' => 'jobs',
            'queue' => 'heavy',
            'retry_after' => 21600,
            'after_commit' => false,
        ],
    ]);
    Notification::fake();
    $this->asUser()->withCampaign();
    Character::factory()->count(3)->create(['campaign_id' => 1]);

    app(QueueService::class)->campaign(Campaign::find(1))->user(auth()->user())->queue();
    expect(DB::table('jobs')->where('queue', 'heavy')->count())->toBe(1);

    $this->artisan('queue:work', ['connection' => 'heavy', '--queue' => 'heavy', '--once' => true])
        ->assertExitCode(0);

    $export = CampaignExport::sole();
    expect($export->finished())->toBeTrue()
        ->and(DB::table('jobs')->where('queue', 'heavy')->count())->toBe(0)
        ->and(DB::table('failed_jobs')->count())->toBe(0);
    Storage::disk('s3')->assertExists($export->path);
    expect(Storage::disk('s3')->visibility($export->path))->toBe('private');

    // The clean-up waits on the default queue (kanka-queue) until the export expires.
    $cleanup = DB::table('jobs')->where('queue', 'default')->sole();
    expect($cleanup->payload)->toContain('FileCleanup')
        ->and($cleanup->available_at)->toBeGreaterThan(now()->addHours((int) config('limits.campaigns.export') - 1)->timestamp);

    $this->get(route('campaign.export-download', [1, $export]))
        ->assertOk()
        ->assertDownload(basename($export->path));
});
