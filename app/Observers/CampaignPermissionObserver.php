<?php

namespace App\Observers;

use App\Enums\Permission;
use App\Models\CampaignPermission;
use App\Models\CampaignRole;
use App\Models\CampaignRoleUser;
use App\Services\Maps\MarkerAudience;

class CampaignPermissionObserver
{
    public function saved(CampaignPermission $permission): void
    {
        $this->resync($permission);
    }

    public function deleted(CampaignPermission $permission): void
    {
        $this->resync($permission);
    }

    /**
     * A view permission decides which map markers a member may see. Members it applies to reload
     * the map they have open, which drops markers they can no longer see.
     */
    protected function resync(CampaignPermission $permission): void
    {
        if ((int) $permission->action !== Permission::View->value || ! $permission->campaign_id) {
            return;
        }

        $userIds = null;
        if ($permission->user_id) {
            $userIds = [(int) $permission->user_id];
        } elseif ($permission->campaign_role_id) {
            $role = CampaignRole::find($permission->campaign_role_id);
            if ($role && ! $role->isPublic()) {
                $userIds = CampaignRoleUser::query()
                    ->where('campaign_role_id', $role->id)
                    ->pluck('user_id')
                    ->all();
            }
        }

        app(MarkerAudience::class)->resync((int) $permission->campaign_id, $userIds);
    }
}
