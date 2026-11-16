<?php

namespace App\Http\Controllers\Api\v1;

use App\Http\Requests\UpdateInventory as Request;
use App\Http\Resources\InventoryResource as Resource;
use App\Models\Campaign;
use App\Models\Entity;
use App\Models\Inventory;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class EntityInventoryApiController extends ApiController
{
    /**
     * @return AnonymousResourceCollection
     *
     * @throws AuthorizationException
     */
    public function index(Campaign $campaign, Entity $entity)
    {
        $this->authorize('access', $campaign);
        $this->authorize('view', $entity);

        // Rows pointing at an item the user cannot see are hidden, as on the entity page.
        return Resource::collection(
            $entity->inventories()
                ->where(function ($query) {
                    $query->whereNull('item_id')->orHas('item.entity');
                })
                ->paginate()
        );
    }

    /**
     * @return resource
     */
    public function show(Campaign $campaign, Entity $entity, Inventory $inventory)
    {
        $this->authorize('access', $campaign);
        $this->authorize('view', $entity);

        abort_if($inventory->item_id && ! $inventory->item?->entity, 404);

        return new Resource($inventory);
    }

    /**
     * @return resource
     *
     * @throws AuthorizationException
     */
    public function store(Request $request, Campaign $campaign, Entity $entity)
    {
        $this->authorize('access', $campaign);
        $this->authorize('update', $entity);
        $data = $request->all();
        $data['entity_id'] = $entity->id;
        $model = Inventory::create($data);

        return new Resource($model);
    }

    /**
     * @return resource
     */
    public function update(Request $request, Campaign $campaign, Entity $entity, Inventory $inventory)
    {
        $this->authorize('access', $campaign);
        $this->authorize('update', $entity);
        $inventory->update($request->all());

        return new Resource($inventory);
    }

    /**
     * @param  Request  $request
     * @return JsonResponse
     *
     * @throws AuthorizationException
     */
    public function destroy(
        \Illuminate\Http\Request $request,
        Campaign $campaign,
        Entity $entity,
        Inventory $inventory
    ) {
        $this->authorize('access', $campaign);
        $this->authorize('update', $entity);
        $inventory->delete();

        return response()->json(null, 204);
    }
}
