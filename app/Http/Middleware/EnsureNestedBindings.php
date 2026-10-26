<?php

namespace App\Http\Middleware;

use App\Models\Entity;
use App\Models\MapMarker;
use App\Models\Relation;
use Closure;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;

/**
 * Chronicle: nested routes (/campaigns/{campaign}/entities/{entity}/posts/{post}, …) bind each
 * model by its own id, without checking that it belongs to the model before it in the URL. The
 * controllers authorize the parent and then hand out the child, so a child of a hidden entity, or
 * of another campaign, could be read through any parent the viewer can open. This checks every
 * pair of neighbouring bound models: when the child has a column pointing at the parent's type
 * (campaign_id, entity_id, map_id, …), it must point at that parent.
 */
class EnsureNestedBindings
{
    /**
     * Columns that don't follow the "<parent>_id" convention, keyed by parent then child class.
     * A null column means the child's "<parent>_id" means something else, so the pair is skipped.
     *
     * @var array<class-string, array<class-string, ?string>>
     */
    protected array $columns = [
        Entity::class => [
            // A relation belongs to its owner; target_id is the other end.
            Relation::class => 'owner_id',
            // A marker's entity_id is the entity it links to, not the map's entity (that
            // pair is checked by the controllers through map_id).
            MapMarker::class => null,
        ],
    ];

    public function handle(Request $request, Closure $next): Response
    {
        $route = $request->route();
        if ($route) {
            $parent = null;
            foreach ($route->parameters() as $value) {
                if (! $value instanceof Model) {
                    continue;
                }
                if ($parent && ! $this->belongs($parent, $value)) {
                    abort(404);
                }
                $parent = $value;
            }
        }

        return $next($request);
    }

    protected function belongs(Model $parent, Model $child): bool
    {
        $overrides = $this->columns[$parent::class] ?? [];
        if (array_key_exists($child::class, $overrides)) {
            $column = $overrides[$child::class];
            if ($column === null) {
                return true;
            }
        } else {
            $column = Str::snake(class_basename($parent)) . '_id';
        }

        $attributes = $child->getAttributes();
        // The child doesn't record this parent (or records none, like the built-in entity
        // types, which have no campaign): nothing to compare.
        if (! array_key_exists($column, $attributes) || $attributes[$column] === null) {
            return true;
        }

        return (int) $attributes[$column] === (int) $parent->getKey();
    }
}
