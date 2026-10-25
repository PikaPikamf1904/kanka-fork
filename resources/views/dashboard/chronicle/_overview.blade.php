<?php /**
 * Shown on a dashboard without widgets: links to the campaign's modules and its latest entries.
 * @var \App\Models\Campaign $campaign
 * @var array{modules: \Illuminate\Support\Collection, recent: \Illuminate\Support\Collection} $overview
 */ ?>
<div class="col-span-12 grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-5 chronicle-overview">
    <section class="lg:col-span-2 bg-box rounded-xl p-4 flex flex-col gap-3" aria-labelledby="overview-browse">
        <h2 id="overview-browse" class="text-lg">{{ __('dashboards/overview.browse') }}</h2>
        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            @foreach ($overview['modules'] as $module)
                <a href="{{ route('entities.index', [$campaign, $module]) }}" class="overview-module flex items-center gap-2 rounded-lg px-3 py-3 bg-base-200 hover:bg-base-300 text-link min-h-12">
                    <x-icon :class="$module->icon()" />
                    <span class="truncate">{{ $module->plural() }}</span>
                </a>
            @endforeach
            <a href="{{ route('connections.web', $campaign) }}" class="overview-module flex items-center gap-2 rounded-lg px-3 py-3 bg-base-200 hover:bg-base-300 text-link min-h-12">
                <x-icon class="fa-regular fa-diagram-project" />
                <span class="truncate">{{ __('dashboards/overview.web') }}</span>
            </a>
        </div>
    </section>

    <section class="bg-box rounded-xl p-4 flex flex-col gap-3" aria-labelledby="overview-recent">
        <h2 id="overview-recent" class="text-lg">{{ __('dashboards/overview.recent') }}</h2>
        @if ($overview['recent']->isEmpty())
            <p class="text-neutral-content">{{ __('dashboards/overview.empty') }}</p>
        @else
            <ul class="flex flex-col gap-1 overview-recent">
                @foreach ($overview['recent'] as $entity)
                    <li class="flex items-center gap-2 min-h-10">
                        <x-icon :class="$entity->entityType->icon()" />
                        <a href="{{ $entity->url() }}" class="text-link truncate grow">{{ $entity->name }}</a>
                        <span class="text-xs text-neutral-content flex-none" title="{{ $entity->updated_at }}">{{ $entity->updated_at?->diffForHumans() }}</span>
                    </li>
                @endforeach
            </ul>
        @endif
    </section>
</div>
