<?php

namespace App\Services\Submenus;

use App\Facades\Module;
use App\Services\CharacterSheets\CharacterSheetService;
use Illuminate\Support\Facades\Gate;

class CharacterSubmenu extends BaseSubmenu implements EntitySubmenu
{
    public function extra(): array
    {
        $items = [];
        $canEdit = isset($this->user) && $this->user->can('update', $this->entity);

        $items['second']['profile'] = [
            'name' => __('entities/profile.show.tab_name'),
            'route' => 'entities.profile',
            'entity' => true,

            'button' => $canEdit ? [
                'url' => $this->entity->url('edit'),
                'icon' => 'fa-regular fa-pencil',
                'tooltip' => __('entities/profile.actions.edit_profile'),
            ] : null,
        ];

        if ($this->showSheet($canEdit)) {
            $items['second']['sheet'] = [
                'name' => __('entities/sheet.show.tab_name'),
                'route' => 'entities.sheet',
                'entity' => true,
                'perm' => 'view-attributes',
            ];
        }

        // @phpstan-ignore-next-line
        $count = $this->entity->child->organisationMemberships()->has('organisation')->has('organisation.entity')->count();
        if ($this->campaign->enabled('organisations') && ($count > 0 || $canEdit)) {
            $items['second']['organisations'] = [
                'name' => Module::plural(config('entities.ids.organisation'), 'entities.organisations'),
                'route' => 'characters.organisations',
                'count' => $count,
            ];
        }

        return $items;
    }

    /**
     * The sheet is made of properties, so it needs the same access as the Properties tab (checked
     * here too, as the mobile menu ignores 'perm'). Only editors see an empty sheet.
     */
    protected function showSheet(bool $canEdit): bool
    {
        if (! $this->campaign->enabled('entity_attributes')) {
            return false;
        }
        if (! Gate::forUser($this->user ?? null)->allows('view-attributes', [$this->entity, $this->campaign])) {
            return false;
        }
        if ($canEdit) {
            return true;
        }

        $service = app(CharacterSheetService::class)->campaign($this->campaign)->entity($this->entity);
        if (isset($this->user)) {
            $service->user($this->user);
        }

        return ! empty(array_filter($service->attributes()));
    }
}
