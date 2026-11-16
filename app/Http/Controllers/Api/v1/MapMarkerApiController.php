<?php

namespace App\Http\Controllers\Api\v1;

use App\Http\Requests\StoreMapMarker as Request;
use App\Http\Resources\MapMarkerResource as Resource;
use App\Models\Campaign;
use App\Models\Map;
use App\Models\MapMarker;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class MapMarkerApiController extends ApiController
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

        // Chronicle: like the explorer, leave out markers in a group or pointing at an entity the
        // viewer can't see (both relations go through their visibility scopes).
        return Resource::collection($map->markers()
            ->where(fn ($query) => $query->whereNull('group_id')->orWhereHas('group'))
            ->where(fn ($query) => $query->whereNull('entity_id')->orWhereHas('entity'))
            ->paginate());
    }

    /**
     * @return resource
     */
    public function show(Campaign $campaign, Map $map, MapMarker $mapMarker)
    {
        $this->authorize('access', $campaign);
        $this->authorize('view', $map->entity);
        // Chronicle: only markers of this map, and only those the explorer would show.
        if ($mapMarker->map_id !== $map->id || ! $mapMarker->visible()) {
            abort(404);
        }

        return new Resource($mapMarker);
    }

    /**
     * @return resource
     *
     * @throws AuthorizationException
     */
    public function store(Request $request, Campaign $campaign, Map $map)
    {
        $this->authorize('access', $campaign);
        $this->authorize('update', $map->entity);
        $data = $request->all();
        $data['map_id'] = $map->id;
        $model = MapMarker::create($data);

        return new Resource($model);
    }

    /**
     * @return resource
     *
     * @throws AuthorizationException
     */
    public function update(
        Request $request,
        Campaign $campaign,
        Map $map,
        MapMarker $mapMarker
    ) {
        $this->authorize('access', $campaign);
        $this->authorize('update', $map->entity);
        if ($mapMarker->map_id !== $map->id) {
            abort(404);
        }
        $mapMarker->update($request->all());

        return new Resource($mapMarker);
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
        MapMarker $mapMarker
    ) {
        $this->authorize('access', $campaign);
        $this->authorize('update', $map->entity);
        if ($mapMarker->map_id !== $map->id) {
            abort(404);
        }
        $mapMarker->delete();

        return response()->json(null, 204);
    }
}
