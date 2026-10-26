<?php

namespace App\Http\Controllers\Api\v1;

use App\Http\Requests\StoreMapGroup as Request;
use App\Http\Resources\MapGroupResource as Resource;
use App\Models\Campaign;
use App\Models\Map;
use App\Models\MapGroup;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class MapGroupApiController extends ApiController
{
    /**
     * @return AnonymousResourceCollection
     *
     * @throws AuthorizationException
     */
    public function index(Campaign $campaign, Map $map)
    {
        $this->authorize('access', $campaign);
        $this->authorize('view', $map->entity);

        return Resource::collection($map->groups()->paginate());
    }

    /**
     * @return resource
     */
    public function show(Campaign $campaign, Map $map, MapGroup $mapGroup)
    {
        $this->authorize('access', $campaign);
        $this->authorize('view', $map->entity);
        // Chronicle: the record must belong to this map, not to one the viewer can't open.
        if ($mapGroup->map_id !== $map->id) {
            abort(404);
        }

        return new Resource($mapGroup);
    }

    public function store(Request $request, Campaign $campaign, Map $map)
    {
        $this->authorize('access', $campaign);
        $this->authorize('update', $map->entity);
        if (! auth()->user()->can('addGroup', [$map, $campaign])) {
            return response()->json(['error' => 'Max amount of map groups reached']);
        }

        $model = MapGroup::create($request->all());

        return new Resource($model);
    }

    public function update(
        Request $request,
        Campaign $campaign,
        Map $map,
        MapGroup $mapGroup
    ) {
        $this->authorize('access', $campaign);
        $this->authorize('update', $map->entity);
        if ($mapGroup->map_id !== $map->id) {
            abort(404);
        }
        $mapGroup->update($request->all());

        return new Resource($mapGroup);
    }

    /**
     * @return JsonResponse
     *
     * @throws AuthorizationException
     */
    public function destroy(
        \Illuminate\Http\Request $request,
        Campaign $campaign,
        Map $map,
        MapGroup $mapGroup
    ) {
        $this->authorize('access', $campaign);
        $this->authorize('update', $map->entity);
        if ($mapGroup->map_id !== $map->id) {
            abort(404);
        }
        $mapGroup->delete();

        return response()->json(null, 204);
    }
}
