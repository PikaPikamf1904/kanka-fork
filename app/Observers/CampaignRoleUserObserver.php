<?php

namespace App\Observers;

use App\Events\Campaigns\Members\RoleUserAdded;
use App\Events\Campaigns\Members\RoleUserRemoved;
use App\Models\CampaignRole;
use App\Models\CampaignRoleUser;
use App\Services\Maps\MarkerAudience;

class CampaignRoleUserObserver
{
    public function created(CampaignRoleUser $campaignRoleUser)
    {
        RoleUserAdded::dispatch($campaignRoleUser, auth()->user());
        $this->resyncMaps($campaignRoleUser);
    }

    public function deleted(CampaignRoleUser $campaignRoleUser)
    {
        RoleUserRemoved::dispatch($campaignRoleUser, auth()->user());
        $this->resyncMaps($campaignRoleUser);
    }

    /**
     * A role change changes which map markers the member may see.
     */
    protected function resyncMaps(CampaignRoleUser $campaignRoleUser): void
    {
        $campaignId = CampaignRole::query()->whereKey($campaignRoleUser->campaign_role_id)->value('campaign_id');
        if ($campaignId) {
            app(MarkerAudience::class)->resync((int) $campaignId, [(int) $campaignRoleUser->user_id]);
        }
    }
}
