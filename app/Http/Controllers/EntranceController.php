<?php

namespace App\Http\Controllers;

use App\Services\Entrance\EntranceService;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\View\View;

class EntranceController extends Controller
{
    public function __construct(protected EntranceService $entrance) {}

    public function show(Request $request): View|RedirectResponse
    {
        if (auth()->check() || $this->entrance->hasValidGrant($request)) {
            return redirect('/');
        }

        return view('entrance.show', ['configured' => $this->entrance->isConfigured()]);
    }

    public function enter(Request $request): RedirectResponse
    {
        $request->validate(['password' => ['required', 'string', 'max:200']]);

        if (! $this->entrance->isConfigured()) {
            return back()->withErrors(['password' => __('entrance.not_configured')]);
        }

        if (! $this->entrance->check((string) $request->input('password'))) {
            Log::warning('Failed entrance attempt', ['ip' => $request->ip()]);

            return back()->withErrors(['password' => __('entrance.wrong')]);
        }

        $request->session()->regenerate();

        return redirect()->intended('/')->withCookie($this->entrance->grantCookie());
    }

    public function leave(Request $request): RedirectResponse
    {
        $request->session()->regenerateToken();

        return redirect()->route('entrance.show')->withCookie($this->entrance->forgetCookie());
    }
}
