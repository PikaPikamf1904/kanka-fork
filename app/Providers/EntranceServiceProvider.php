<?php

namespace App\Providers;

use App\Services\Entrance\EntranceService;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

class EntranceServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(EntranceService::class);
    }

    public function boot(): void
    {
        RateLimiter::for('entrance', function (Request $request) {
            $ip = (string) $request->ip();
            $respond = function (Request $request, array $headers) {
                return response()->view('entrance.show', [
                    'throttled' => true,
                    'configured' => app(EntranceService::class)->isConfigured(),
                ], 429, $headers + ['X-Robots-Tag' => 'noindex']);
            };

            return [
                Limit::perMinute(5)->by('entrance:m:' . $ip)->response($respond),
                Limit::perHour(30)->by('entrance:h:' . $ip)->response($respond),
            ];
        });
    }
}
