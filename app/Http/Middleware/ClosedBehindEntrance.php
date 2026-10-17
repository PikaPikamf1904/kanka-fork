<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * For routes outside the "web" group that anyone could call, such as the public discovery
 * API (it lists public campaigns with their names and images). While the shared entrance is
 * on, the site is private, so these answer 404 instead.
 */
class ClosedBehindEntrance
{
    public function handle(Request $request, Closure $next): Response
    {
        abort_if((bool) config('entrance.enabled'), 404);

        return $next($request);
    }
}
