<?php

namespace App\Http\Controllers\Datagrid2;

use App\Models\MapGroup;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;

trait BulkControllerTrait
{
    /**
     * List of valid bulk actions.
     *
     * @return string[]
     */
    public function validBulkActions(array $values = ['delete', 'edit', 'patch']): array
    {
        return $values;
    }

    /**
     * @param  array<string, int>  $parent  Chronicle: the parent the ids must belong to (for
     *                                      example ['map_id' => 3]). Without it, any id of the class
     *                                      could be deleted or patched through any parent the user
     *                                      may edit, including another campaign's.
     */
    public function bulkProcess(Request $request, string $className, array $parent): int
    {
        $action = $request->get('action');
        $models = $request->get('model');

        $count = 0;
        $patch = $request->except('models', 'action');
        if ($action === 'patch') {
            // Clean up the request. Skip nulls
            foreach ($patch as $field => $value) {
                if ($value !== null) {
                    continue;
                }
                unset($patch[$field]);
            }
        }
        foreach ($models as $id) {
            /** @var MapGroup|Model|null $model */
            $model = $className::query()->where($parent)->find($id);
            if (empty($model)) {
                continue;
            }

            if ($action === 'delete') {
                $model->delete();
                $count++;
            } elseif ($action === 'patch') {
                /** @var MapGroup $model */
                $model->patch($patch);
                $count++;
            }
        }

        return $count;
    }

    public function bulkBatch(string $route, string $view, array $models, mixed $model = null)
    {
        return view('layouts.datagrid.bulks.update')
            ->with('campaign', $this->campaign)
            ->with('route', $route)
            ->with('view', $view)
            ->with('models', $models)
            ->with('model', $model);
    }
}
