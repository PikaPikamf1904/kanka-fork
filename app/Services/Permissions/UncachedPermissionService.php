<?php

namespace App\Services\Permissions;

use App\Models\CampaignPermission;
use App\Models\CampaignRole;
use App\Models\CampaignRoleUser;

/**
 * The same entity permission rules as PermissionService, for any user, not just the one making
 * the request. The regular service reads roles and role permissions through request-wide caches
 * (UserCache, RolePermission) that are keyed for the current user, so it can't answer "what can
 * this other member see?" reliably. This one queries the database directly instead, and every
 * instance is fresh, so it can be used for many users in one request.
 */
class UncachedPermissionService extends PermissionService
{
    protected function loadRoles(): self
    {
        if (isset($this->loadedRoles)) {
            return $this;
        }
        $this->loadedRoles = 0;

        $roles = CampaignRole::query()
            ->where('campaign_id', $this->campaign->id)
            ->whereIn('id', CampaignRoleUser::query()->where('user_id', $this->user->id)->select('campaign_role_id'))
            ->get(['id', 'is_admin']);

        $roleIDs = [];
        foreach ($roles as $role) {
            $this->loadedRoles++;
            if ($role->is_admin) {
                $this->admin = true;

                return $this;
            }
            $roleIDs[] = $role->id;
        }
        $this->parseRoles($roleIDs);

        return $this;
    }

    protected function parseRole(CampaignRole $role): void
    {
        $this->publicRoleId = $role->id;
        foreach ($role->permissions()->get() as $permission) {
            $this->parseRolePermission($permission);
        }
    }

    protected function parseRoles(array $roleIDs): void
    {
        foreach (CampaignPermission::roleIDs($roleIDs)->get() as $permission) {
            $this->parseRolePermission($permission);
        }
    }

    protected function userRoles(): array
    {
        return CampaignRole::query()
            ->where('campaign_id', $this->campaign->id)
            ->whereIn('id', CampaignRoleUser::query()->where('user_id', $this->user->id)->select('campaign_role_id'))
            ->pluck('id')
            ->all();
    }
}
