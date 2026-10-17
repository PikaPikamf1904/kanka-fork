<?php

namespace App\Http\Controllers\Entity;

use App\Http\Controllers\Controller;
use App\Models\Campaign;
use App\Models\Entity;
use App\Services\CharacterSheets\CharacterSheetService;
use App\Traits\CampaignAware;
use App\Traits\GuestAuthTrait;
use Illuminate\Http\Request;

/**
 * A D&D 2024 reference sheet for characters. The sheet is stored as the character's properties,
 * so it follows the same rules as the Properties page: the properties module must be enabled,
 * viewing needs view-attributes and editing needs update and attributes.
 */
class CharacterSheetController extends Controller
{
    use CampaignAware;
    use GuestAuthTrait;

    public function index(Campaign $campaign, Entity $entity)
    {
        if (! $campaign->enabled('entity_attributes')) {
            return $this->moduleDisabled($campaign, $entity);
        }
        $this->authorizeView($campaign, $entity);

        return view('entities.pages.sheet.index', $this->data($campaign, $entity));
    }

    public function print(Campaign $campaign, Entity $entity)
    {
        if (! $campaign->enabled('entity_attributes')) {
            return $this->moduleDisabled($campaign, $entity);
        }
        $this->authorizeView($campaign, $entity);

        return view('entities.pages.sheet.print', $this->data($campaign, $entity) + ['printing' => true]);
    }

    public function edit(Campaign $campaign, Entity $entity)
    {
        if (! $campaign->enabled('entity_attributes')) {
            return $this->moduleDisabled($campaign, $entity);
        }
        $this->authorizeEdit($campaign, $entity);

        return view('entities.pages.sheet.edit', $this->data($campaign, $entity));
    }

    public function update(Request $request, Campaign $campaign, Entity $entity)
    {
        if (! $campaign->enabled('entity_attributes')) {
            return $this->moduleDisabled($campaign, $entity);
        }
        $this->authorizeEdit($campaign, $entity);

        $service = $this->service($campaign, $entity);
        $data = $request->validate($service->rules(), [], $service->attributeNames());
        $service->save($data['fields'] ?? []);

        return redirect()->route('entities.sheet', [$campaign, $entity])
            ->with('success', __('entities/sheet.update.success', ['name' => $entity->name]));
    }

    protected function authorizeView(Campaign $campaign, Entity $entity): void
    {
        $this->campaign($campaign)->authEntityView($entity);
        if (! $entity->isCharacter()) {
            abort(404);
        }
        $this->authorize('view-attributes', [$entity, $campaign]);
    }

    protected function authorizeEdit(Campaign $campaign, Entity $entity): void
    {
        if ($entity->isMissingChild()) {
            abort(404);
        }
        $this->authorize('update', $entity);
        if (! $entity->isCharacter()) {
            abort(404);
        }
        $this->authorize('attributes', [$entity, $campaign]);
    }

    /**
     * A new service for each request, so a user set on an earlier one never carries over.
     */
    protected function service(Campaign $campaign, Entity $entity): CharacterSheetService
    {
        $service = app(CharacterSheetService::class);
        $service->campaign($campaign)->entity($entity);
        if (auth()->check()) {
            $service->user(auth()->user());
        }

        return $service;
    }

    protected function data(Campaign $campaign, Entity $entity): array
    {
        $service = $this->service($campaign, $entity);
        $attributes = $service->attributes();
        $values = $service->values($attributes);

        return [
            'campaign' => $campaign,
            'entity' => $entity,
            'sheet' => $service->sheet(),
            'fields' => $service->sheet()->fields(),
            'attributes' => $attributes,
            'values' => $values,
            'computed' => $service->sheet()->compute($values),
        ];
    }

    protected function moduleDisabled(Campaign $campaign, Entity $entity)
    {
        return redirect()->route('entities.show', [$campaign, $entity])->with(
            'error_raw',
            __('campaigns.settings.errors.module-disabled', [
                'fix' => '<a href="' . route('campaign.modules', [$campaign, '#entity_attributes']) . '" class="text-link">' . __('crud.fix-this-issue') . '</a>',
            ])
        );
    }
}
