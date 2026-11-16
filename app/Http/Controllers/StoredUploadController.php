<?php

namespace App\Http\Controllers;

use App\Facades\CampaignLocalization;
use App\Models\Campaign;
use App\Models\Entity;
use App\Models\EntityAsset;
use App\Models\Image;
use App\Models\MapLayer;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Serve local uploads only after Kanka has resolved the owning campaign and asset ACLs.
 * Site branding and other files under public/ remain ordinary public static assets.
 */
class StoredUploadController extends Controller
{
    public function show(string $path): StreamedResponse
    {
        abort_unless(config('filesystems.default') === 'public', 404);
        abort_if(str_contains($path, '..') || str_contains($path, '\\'), 404);
        if (preg_match('#^campaigns/(\d+)/#', $path, $matches) || preg_match('#^w/(\d+)/#', $path, $matches)) {
            $campaign = Campaign::acl($matches[1])->firstOrFail();
            request()->route()->setParameter('campaign', $campaign);
            CampaignLocalization::forceCampaign($campaign);
            $this->authorizeUpload($path, $campaign);
        } elseif (preg_match('#^users/\d+/[^/]+$#', $path)) {
            // User profile pages are public; only a path currently assigned as an avatar is served.
            User::query()->where('avatar', $path)->firstOrFail();
        } else {
            abort(404);
        }

        $disk = Storage::disk('public');
        abort_unless($disk->exists($path), 404);

        $stream = $disk->readStream($path);
        abort_unless(is_resource($stream), 404);

        return response()->stream(function () use ($stream): void {
            fpassthru($stream);
            fclose($stream);
        }, 200, [
            'Content-Type' => $disk->mimeType($path) ?: 'application/octet-stream',
            'Content-Disposition' => 'inline',
            'Cache-Control' => 'private, no-store, max-age=0',
            'Vary' => 'Cookie',
            'X-Content-Type-Options' => 'nosniff',
            'X-Robots-Tag' => 'noindex',
        ]);
    }

    protected function authorizeUpload(string $path, Campaign $campaign): void
    {
        $campaignId = (int) $campaign->id;
        if (str_starts_with($path, 'w/')) {
            if ($campaign->image === $path || $campaign->header_image === $path) {
                return;
            }

            abort_unless(preg_match('#^w/' . $campaignId . '/legacy/[a-f0-9-]{36}\.[a-z0-9]+$#i', $path), 404);

            $visibleEntity = Entity::query()
                ->where('campaign_id', $campaignId)
                ->where(fn ($query) => $query->where('image_path', $path)->orWhere('header_image', $path))
                ->exists();
            $visibleMapLayer = MapLayer::query()
                ->where('image_path', $path)
                ->whereHas('map', fn ($query) => $query->where('campaign_id', $campaignId)->whereHas('entity'))
                ->exists();

            abort_unless($visibleEntity || $visibleMapLayer, 404);

            return;
        }

        if (preg_match('#^campaigns/\d+/([a-f0-9-]{36})/(\d+)\.([a-z0-9]+)$#i', $path, $match)
            || preg_match('#^campaigns/\d+/([a-f0-9-]{36})\.([a-z0-9]+)$#i', $path, $legacyMatch)) {
            $match = $match ?: $legacyMatch;
            $image = Image::query()
                ->where('campaign_id', $campaignId)
                ->whereKey($match[1])
                ->firstOrFail();

            abort_unless($image->path === $path, 404);
            $this->authorizeImageUse($image, $campaignId);

            return;
        }

        if (preg_match('#^campaigns/\d+/tiles/([a-f0-9-]{36})/\d+/\d+/\d+\.webp$#i', $path, $match)) {
            $image = Image::query()
                ->where('campaign_id', $campaignId)
                ->whereKey($match[1])
                ->firstOrFail();

            abort_unless(str_starts_with($path, $image->tilesPath() . '/'), 404);
            abort_unless($image->isTiled(), 404);
            $this->authorizeImageUse($image, $campaignId);

            return;
        }

        $entity = Entity::query()
            ->where('campaign_id', $campaignId)
            ->where(fn ($query) => $query->where('image_path', $path)->orWhere('header_image', $path))
            ->first();
        if ($entity) {
            return;
        }

        $asset = EntityAsset::query()
            ->where('metadata->path', $path)
            ->whereHas('entity', fn ($query) => $query->where('campaign_id', $campaignId))
            ->first();
        if ($asset) {
            return;
        }

        $layer = MapLayer::query()
            ->where('image_path', $path)
            ->whereHas('map', fn ($query) => $query->where('campaign_id', $campaignId))
            ->first();
        abort_unless($layer, 404);
    }

    /**
     * Image visibility controls gallery assets. When an image is attached to campaign
     * content, at least one owning entity/map must also pass Kanka's normal ACL scopes.
     */
    protected function authorizeImageUse(Image $image, int $campaignId): void
    {
        $hasReferences = DB::table('entities')
            ->where('campaign_id', $campaignId)
            ->where(fn ($query) => $query->where('image_uuid', $image->id)->orWhere('header_uuid', $image->id))
            ->exists()
            || DB::table('entity_assets as assets')
                ->join('entities', 'entities.id', '=', 'assets.entity_id')
                ->where('entities.campaign_id', $campaignId)
                ->where('assets.image_uuid', $image->id)
                ->exists()
            || DB::table('map_layers as layers')
                ->join('maps', 'maps.id', '=', 'layers.map_id')
                ->where('maps.campaign_id', $campaignId)
                ->where('layers.image_uuid', $image->id)
                ->exists()
            || DB::table('inventories as inventory')
                ->join('entities', 'entities.id', '=', 'inventory.entity_id')
                ->where('entities.campaign_id', $campaignId)
                ->where('inventory.image_uuid', $image->id)
                ->exists()
            || DB::table('image_mentions as mentions')
                ->join('entities', 'entities.id', '=', 'mentions.entity_id')
                ->where('entities.campaign_id', $campaignId)
                ->where('mentions.image_id', $image->id)
                ->exists();

        if (! $hasReferences) {
            return;
        }

        $visibleEntity = $image->inEntities() !== []
            || $image->mapLayers()->whereHas('map', fn ($query) => $query->whereHas('entity'))->exists()
            || $image->inventories()->whereHas('entity')->exists()
            || $image->mentions()
                ->whereHas('entity')
                ->where(fn ($query) => $query->whereNull('post_id')->orWhereHas('post'))
                ->exists();

        abort_unless($visibleEntity, 404);
    }
}
