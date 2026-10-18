<div class="dropdown">
    <button type="button" class="btn2" data-dropdown aria-expanded="false">
        <x-icon class="fa-regular fa-cog" />
        <span class="hidden lg:inline">
            {{ __('Configure') }}
        </span>
    </button>
    <div class="dropdown-menu hidden" role="menu">
        <div class="overflow-y-auto max-h-80">
            <x-dropdowns.item
                icon="fa-regular fa-shuffle"
                :link="route('bookmarks.reorder', [$campaign])">
                {{ __('bookmarks.reorder.title') }}
            </x-dropdowns.item>
            <x-dropdowns.item
                icon="fa-regular fa-bars-staggered"
                :link="route('campaign-sidebar', [$campaign])">
                {{ __('bookmarks.actions.customise') }}
            </x-dropdowns.item>
        </div>
    </div>
</div>

