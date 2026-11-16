<?php

namespace App\Http\Controllers\Entity\Maps;

use App\Http\Controllers\Controller;
use App\Http\Resources\Maps\Explore\PinResource;
use App\Models\Campaign;
use App\Models\Entity;
use App\Models\Map;
use App\Services\Maps\ExploreApiService;
use App\Traits\CampaignAware;
use App\Traits\GuestAuthTrait;

class ApiController extends Controller
{
    use CampaignAware;
    use GuestAuthTrait;

    public function __construct(protected ExploreApiService $apiService) {}

    public function index(Campaign $campaign, Entity $entity)
    {
        $this->campaign($campaign)->authEntityView($entity);

        if (! $entity->isMap()) {
            abort(404);
        }

        if (auth()->check()) {
            $this->apiService->user(auth()->user());
        }

        /** @var Map $map */
        $map = $entity->child;

        return response()->json(
            $this->apiService
                ->campaign($campaign)
                ->map($map)
                ->load()
        );
    }

    /**
     * One marker, as the explorer payload would include it. Live updates carry only marker ids;
     * clients fetch the marker here, under the same checks as the full payload. A marker the user
     * can't see answers exactly like one that doesn't exist.
     */
    public function marker(Campaign $campaign, Entity $entity, int $pin)
    {
        $this->campaign($campaign)->authEntityView($entity);

        if (! $entity->isMap()) {
            abort(404);
        }

        /** @var Map $map */
        $map = $entity->child;
        $marker = $map->markers()->whereKey($pin)->first();
        if (! $marker || ! $marker->visible()) {
            abort(404);
        }

        return response()->json(
            new PinResource($marker)->campaign($campaign)->mapEntity($entity)
        );
    }
}
