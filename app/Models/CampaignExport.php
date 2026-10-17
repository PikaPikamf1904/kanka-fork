<?php

namespace App\Models;

use App\Enums\CampaignExportStatus;
use App\Models\Concerns\HasUser;
use App\Models\Concerns\SortableTrait;
use App\Observers\CampaignExportObserver;
use Illuminate\Database\Eloquent\Attributes\ObservedBy;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\MassPrunable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Class CampaignExport
 *
 * @property int $id
 * @property int $campaign_id
 * @property int $status
 * @property string $path
 * @property float $progress
 */
#[ObservedBy(CampaignExportObserver::class)]
class CampaignExport extends Model
{
    use HasUser;
    use MassPrunable;
    use SortableTrait;

    public $fillable = [
        'size',
        'type',
        'status',
        'campaign_id',
        'created_by',
        'path',
    ];

    public $sortable = [
        'status',
        'type',
        'created_at',
        'created_by',
    ];

    public $casts = [
        'status' => CampaignExportStatus::class,
    ];

    protected string $userField = 'created_by';

    /**
     * Automatically prune old elements from the db
     */
    public function prunable(): Builder
    {
        return static::where('updated_at', '<=', now()->subDays(90));
    }

    /**
     * @return BelongsTo<Campaign, $this>
     */
    public function campaign(): BelongsTo
    {
        return $this->belongsTo('App\Models\Campaign', 'campaign_id', 'id');
    }

    public function finished(): bool
    {
        return $this->status === CampaignExportStatus::finished;
    }

    public function running(): bool
    {
        return $this->status === CampaignExportStatus::running;
    }

    public function scheduled(): bool
    {
        return $this->status === CampaignExportStatus::scheduled;
    }

    public function failed(): bool
    {
        return $this->status === CampaignExportStatus::failed;
    }

    /**
     * Export archives are deleted a few hours after creation (limits.campaigns.export).
     */
    public function expired(): bool
    {
        return $this->created_at->lt(now()->subHours((int) config('limits.campaigns.export')));
    }

    /**
     * The archive's path on the s3 disk, only for a finished export stored in this
     * campaign's own export folder.
     */
    public function storedPath(): ?string
    {
        if (! $this->finished() || empty($this->path) || str_contains($this->path, '..')) {
            return null;
        }
        if (! preg_match('#^exports/' . (int) $this->campaign_id . '/[A-Za-z0-9._-]+\.zip$#', $this->path)) {
            return null;
        }

        return $this->path;
    }
}
