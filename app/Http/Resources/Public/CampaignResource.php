<?php

namespace App\Http\Resources\Public;

use App\Models\Campaign;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Number;

class CampaignResource extends JsonResource
{
    public function toArray($request)
    {
        /** @var Campaign $campaign */
        $campaign = $this->resource;

        return [
            'id' => $campaign->id,
            'thumb' => $campaign->image ? $campaign->thumbnail(320, 240) : asset('images/chronicle/vale.svg'),
            'name' => $campaign->name,
            'justify' => $campaign->spotlight?->url,
            'link' => route('dashboard', $campaign),
            'followers' => Number::format($campaign->follower()),
            'entities' => Number::format($campaign->visible_entity_count),
            'locale' => $campaign->locale,
            'system' => $campaign->getSystems(),
            'is_open' => $campaign->isOpen(),
            'is_prioritised' => $campaign->is_prioritised,
        ];
    }
}
