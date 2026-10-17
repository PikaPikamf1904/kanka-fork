<?php

namespace App\Http\Controllers\Settings;

use App\Http\Controllers\Controller;
use App\Services\Entrance\EntranceService;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\View\View;

/** Lets the configured manager accounts change the shared entrance password. */
class EntranceController extends Controller
{
    public function __construct(protected EntranceService $entrance)
    {
        $this->middleware(['auth', 'password.confirm']);
    }

    public function index(): View
    {
        $this->authorizeManager();

        return view('settings.entrance', [
            'enabled' => (bool) config('entrance.enabled'),
            'configured' => $this->entrance->isConfigured(),
            'updatedAt' => $this->entrance->updatedAt(),
            'minLength' => (int) config('entrance.min_length'),
        ]);
    }

    public function update(Request $request): RedirectResponse
    {
        $this->authorizeManager();

        $data = $request->validate([
            'password' => ['required', 'string', 'min:' . (int) config('entrance.min_length'), 'max:200', 'confirmed'],
        ]);
        $this->entrance->setPassword($data['password']);

        return redirect()->route('settings.entrance')->with('status', __('entrance.updated'));
    }

    protected function authorizeManager(): void
    {
        abort_unless(in_array((int) auth()->id(), config('entrance.managers'), true), 404);
    }
}
