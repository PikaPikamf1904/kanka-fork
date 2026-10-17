<?php

namespace App\Http\Controllers\Campaign;

use App\Http\Controllers\Controller;
use App\Models\Campaign;
use App\Models\CampaignExport;
use App\Services\Campaign\Exports\QueueService;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

class ExportController extends Controller
{
    public function __construct(protected QueueService $queueService)
    {
        $this->middleware('auth');
    }

    public function index(Campaign $campaign)
    {
        $this->authorize('setting', $campaign);

        return view('campaigns.export', compact('campaign'));
    }

    /**
     * Dispatch the campaign export jobs and have the user wait for a bit
     *
     * @throws AuthorizationException
     */
    public function export(Request $request, Campaign $campaign)
    {
        $this->authorize('setting', $campaign);
        if (request()->ajax()) {
            return response()->json();
        }

        if (! $request->user()->can('export', $campaign)) {
            return redirect()
                ->route('campaign.export', $campaign)
                ->withError(__('campaigns/export.errors.limit'));
        }

        if ($request->get('type') == 2 && ! $campaign->premium()) {
            return redirect()
                ->route('campaign.export', $campaign)
                ->withError(__('campaigns/export.errors.premium'));
        }

        $this->queueService
            ->campaign($campaign)
            ->user($request->user())
            ->type($request->get('type'))
            ->queue();

        $adminRoleName = $campaign->adminRoleName();

        return redirect()
            ->route('campaign.export', $campaign)
            ->withSuccess(__('campaigns/export.success', [
                'admin' => $adminRoleName,
            ]));
    }

    /**
     * Stream a finished export to a campaign admin. Export archives are stored privately
     * and never served from a public URL.
     */
    public function download(Campaign $campaign, CampaignExport $campaignExport)
    {
        $this->authorize('setting', $campaign);
        if ((int) $campaignExport->campaign_id !== $campaign->id) {
            abort(404);
        }

        $path = $campaignExport->storedPath();
        $disk = Storage::disk('s3');
        if ($path === null || ! $disk->exists($path)) {
            abort(404);
        }
        if ($campaignExport->expired()) {
            $disk->delete($path);
            abort(404);
        }

        return $disk->download($path, basename($path), [
            'Cache-Control' => 'private, no-store',
        ]);
    }
}
