<?php

namespace App\Services\Maps;

use App\Enums\Permission;
use App\Enums\Visibility;
use App\Events\Maps\MapMarkersResync;
use App\Events\Maps\MarkerChanged;
use App\Models\Campaign;
use App\Models\CampaignUser;
use App\Models\Entity;
use App\Models\Map;
use App\Models\MapGroup;
use App\Models\MapMarker;
use App\Models\Scopes\VisibilityIDScope;
use App\Models\User;
use App\Services\Permissions\UncachedPermissionService;

/**
 * Works out which campaign members can see a map marker, so live map updates only ever go to
 * them. It applies the same rules as the explorer API (ExploreApiService::load()): the member can
 * view the map entity, the marker's and its group's visibility_id let them see it, and a linked
 * entity exists and passes their entity permissions. Updates then go out per user, carrying only
 * the marker id, and clients fetch the marker itself through the permission-checked API.
 */
class MarkerAudience
{
    /** @var array<int, array<int, array<string, mixed>>> campaign id => user id => permissions */
    protected array $profiles = [];

    /** @var array<string, array<int, int>> users who could see a marker before a pending change */
    protected array $pending = [];

    /** @var array<string, bool> resyncs already sent in this request */
    protected array $resynced = [];

    /**
     * The ids of the campaign members who can see the marker. With $original, the marker is
     * judged as it was before its unsaved changes.
     *
     * @return array<int, int>
     */
    public function recipients(MapMarker $marker, bool $original = false): array
    {
        $value = fn (string $key) => $original ? $marker->getOriginal($key) : $marker->getAttribute($key);

        $map = Map::withInvisible()->find($value('map_id'));
        $mapEntity = $map?->entity()->withInvisible()->first();
        if (! $mapEntity) {
            return [];
        }

        $group = null;
        if ($value('group_id')) {
            $group = MapGroup::withoutGlobalScope(VisibilityIDScope::class)->find($value('group_id'));
            if (! $group) {
                return [];
            }
        }

        $entity = null;
        if ($value('entity_id')) {
            $entity = Entity::withInvisible()->find($value('entity_id'));
            if (! $entity || $entity->isMissingChild()) {
                return [];
            }
        }

        $users = [];
        foreach ($this->profiles($mapEntity->campaign_id) as $userId => $profile) {
            if (! $this->canSeeEntity($profile, $mapEntity)
                || ! $this->canSeeVisibility($profile, $value('visibility_id'), $value('created_by'))
                || ($group && ! $this->canSeeVisibility($profile, $group->visibility_id, $group->created_by))
                || ($entity && ! $this->canSeeEntity($profile, $entity))
            ) {
                continue;
            }
            $users[] = $userId;
        }

        return $users;
    }

    /**
     * Remember who could see the marker before the change that is about to be saved.
     */
    public function before(MapMarker $marker): void
    {
        $this->pending[$this->key($marker)] = [
            'map_id' => (int) $marker->getOriginal('map_id'),
            'users' => $this->recipients($marker, true),
        ];
    }

    /**
     * Tell each member who can see the marker now, or could see it before, what happened to it.
     * Members who can see it neither before nor after hear nothing at all.
     */
    public function after(MapMarker $marker, string $action): void
    {
        $before = $this->pending[$this->key($marker)] ?? ['map_id' => (int) $marker->map_id, 'users' => []];
        unset($this->pending[$this->key($marker)]);

        $after = $action === 'deleted' ? [] : $this->recipients($marker);
        $mapId = (int) $marker->map_id;

        if ($before['map_id'] !== $mapId) {
            // Moved to another map: it's gone from the old one, and new on this one.
            $this->dispatch($before['map_id'], $marker->id, 'deleted', $before['users']);
            $this->dispatch($mapId, $marker->id, 'created', $after);

            return;
        }

        $this->dispatch($mapId, $marker->id, 'deleted', array_diff($before['users'], $after));
        $this->dispatch($mapId, $marker->id, 'created', array_diff($after, $before['users']));
        $this->dispatch($mapId, $marker->id, 'updated', array_intersect($after, $before['users']));
    }

    /**
     * A group's visibility is about to change, or the group is about to be deleted (which moves
     * its markers out of any group): remember who can see each of its markers now.
     */
    public function beforeGroup(MapGroup $group): void
    {
        $markers = [];
        foreach (MapMarker::query()->withoutGlobalScope(VisibilityIDScope::class)->where('group_id', $group->id)->get() as $marker) {
            $markers[$marker->id] = $this->recipients($marker);
        }
        $this->pending['group-' . $group->id] = ['map_id' => (int) $group->map_id, 'markers' => $markers];
    }

    /**
     * Send each of the group's markers to the members who gained or lost sight of it.
     */
    public function afterGroup(MapGroup $group): void
    {
        $before = $this->pending['group-' . $group->id] ?? null;
        unset($this->pending['group-' . $group->id]);
        if (! $before || empty($before['markers'])) {
            return;
        }

        $markers = MapMarker::query()
            ->withoutGlobalScope(VisibilityIDScope::class)
            ->whereIn('id', array_keys($before['markers']))
            ->get()
            ->keyBy('id');
        foreach ($before['markers'] as $markerId => $users) {
            $marker = $markers->get($markerId);
            $after = $marker ? $this->recipients($marker) : [];
            $this->dispatch($before['map_id'], $markerId, 'deleted', array_diff($users, $after));
            $this->dispatch($before['map_id'], $markerId, 'created', array_diff($after, $users));
        }
    }

    /**
     * Something that decides what members can see on maps changed (permissions, roles, an
     * entity's privacy). Tell the affected members to reload the map they have open; the
     * message carries nothing but the campaign id. Without $userIds, every member is told.
     *
     * @param  array<int, int>|null  $userIds
     */
    public function resync(int $campaignId, ?array $userIds = null): void
    {
        unset($this->profiles[$campaignId]);

        // Without a map, nobody has one open to reload.
        if (! Map::withoutGlobalScopes()->where('campaign_id', $campaignId)->exists()) {
            return;
        }

        $userIds ??= CampaignUser::query()->where('campaign_id', $campaignId)->pluck('user_id')->all();
        $send = [];
        foreach ($userIds as $userId) {
            $key = $campaignId . '-' . $userId;
            if (! isset($this->resynced[$key])) {
                $this->resynced[$key] = true;
                $send[] = (int) $userId;
            }
        }

        if (! empty($send)) {
            MapMarkersResync::dispatch($campaignId, $send);
        }
    }

    /**
     * @param  array<int, int>  $userIds
     */
    protected function dispatch(int $mapId, int $markerId, string $action, array $userIds): void
    {
        $userIds = array_values(array_unique($userIds));
        if (empty($userIds)) {
            return;
        }
        MarkerChanged::dispatch($mapId, $markerId, $action, $userIds);
    }

    /**
     * Each member's entity permissions in the campaign, computed once per request.
     *
     * @return array<int, array<string, mixed>>
     */
    protected function profiles(int $campaignId): array
    {
        if (isset($this->profiles[$campaignId])) {
            return $this->profiles[$campaignId];
        }

        $campaign = Campaign::find($campaignId);
        if (! $campaign) {
            return [];
        }

        $profiles = [];
        $members = User::query()
            ->whereIn('id', CampaignUser::query()->where('campaign_id', $campaignId)->select('user_id'))
            ->get();
        foreach ($members as $user) {
            $permissions = new UncachedPermissionService()
                ->campaign($campaign)
                ->user($user)
                ->action(Permission::View);

            $profiles[$user->id] = [
                'id' => $user->id,
                'admin' => $permissions->isAdmin(),
                'allowed' => array_flip(array_filter($permissions->allowedEntities())),
                'types' => array_flip(array_filter($permissions->allowedEntityTypes())),
                'denied' => array_flip(array_filter($permissions->deniedEntities())),
            ];
        }

        return $this->profiles[$campaignId] = $profiles;
    }

    /**
     * Mirrors AclScope::applyToEntity() for a logged-in member.
     */
    protected function canSeeEntity(array $profile, Entity $entity): bool
    {
        if ($profile['admin']) {
            return true;
        }

        return ! $entity->is_private
            && ! isset($profile['denied'][$entity->id])
            && (isset($profile['allowed'][$entity->id]) || isset($profile['types'][$entity->type_id]));
    }

    /**
     * Mirrors VisibilityIDScope for a member of the campaign.
     */
    protected function canSeeVisibility(array $profile, mixed $visibility, mixed $createdBy): bool
    {
        $visibility = $visibility instanceof Visibility ? $visibility : Visibility::tryFrom((int) $visibility);
        if (! $visibility) {
            return false;
        }

        if (in_array($visibility, [Visibility::Self, Visibility::AdminSelf]) && (int) $createdBy === $profile['id']) {
            return true;
        }

        $allowed = $profile['admin']
            ? [Visibility::All, Visibility::Admin, Visibility::AdminSelf, Visibility::Member]
            : [Visibility::All, Visibility::Member];

        return in_array($visibility, $allowed);
    }

    protected function key(MapMarker $marker): string
    {
        return (string) spl_object_id($marker);
    }
}
