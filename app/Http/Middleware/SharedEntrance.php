<?php

namespace App\Http\Middleware;

use App\Services\Entrance\EntranceService;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Gate for visitors who are not logged in. Passing it grants nothing: the visitor stays a
 * guest and Kanka's own permissions apply.
 */
class SharedEntrance
{
    /** Routes reachable without having entered. */
    public const ALLOWED_ROUTES = [
        'entrance.show',
        'entrance.enter',
        'entrance.leave',
        'login',
        'logout',
        'password.request',
        'password.email',
        'password.reset',
        'password.update',
        'auth.verify-2fa',
    ];

    /**
     * Routes without a name: health, and the sign-in form's POST (only its GET is named
     * "login"), so the administrator can sign in without the shared password.
     */
    public const ALLOWED_PATHS = ['up', 'login'];

    public function __construct(protected EntranceService $entrance) {}

    public function handle(Request $request, Closure $next): Response
    {
        if (! config('entrance.enabled')) {
            return $next($request);
        }
        if (auth()->check()) {
            return $next($request);
        }
        if ($this->isAllowlisted($request)) {
            return $next($request);
        }
        if ($this->entrance->hasValidGrant($request)) {
            return $next($request);
        }

        if ($request->expectsJson()) {
            return response()->json(['message' => 'Entrance required.'], 401)
                ->header('X-Robots-Tag', 'noindex');
        }

        return redirect()->guest(route('entrance.show'))
            ->header('X-Robots-Tag', 'noindex');
    }

    protected function isAllowlisted(Request $request): bool
    {
        $name = $request->route()?->getName();
        if ($name !== null && in_array($name, self::ALLOWED_ROUTES, true)) {
            return true;
        }

        return $request->is(self::ALLOWED_PATHS);
    }
}
