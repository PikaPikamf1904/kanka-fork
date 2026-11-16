<?php

namespace App\Http\Controllers\Entity\Posts;

use App\Http\Controllers\Controller;
use App\Models\Campaign;
use App\Models\Post;
use App\Services\Entity\TemplateService;

class TemplateController extends Controller
{
    protected TemplateService $service;

    public function __construct(TemplateService $templateService)
    {
        $this->middleware('auth');
        $this->service = $templateService;
    }

    public function update(Campaign $campaign, Post $post)
    {
        $this->authorize('setPostTemplates', $campaign);
        // Chronicle: the post must be in this campaign, not just any post id.
        if ($post->entity?->campaign_id !== $campaign->id) {
            abort(404);
        }

        if (request()->ajax()) {
            return response()->json();
        }

        $this->service->post($post)->toggle();

        return redirect()->back()
            ->with(
                'success',
                __('posts/actions.templates.success.' . ($post->isTemplate() ? 'set' : 'unset'), ['name' => $post->name])
            );
    }
}
