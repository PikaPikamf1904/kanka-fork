<x-box class="widget-help" id="dashboard-widget-{{ $widget->id }}">
    <span class="widget-title block text-lg mb-4">
        {{ __('dashboards/widgets/help.title') }}
    </span>
    <div class="">
        <ul class="flex flex-col gap-2 lg:gap-3 xl:gap-4 list-none m-0 px-1">
            <li>
                <a href="mailto:{{ config('app.email') }}" class="text-link">
                    <x-icon class="fa-regular fa-envelope" />
                    {{ config('app.email') }}
                </a>
            </li>
        </ul>
    </div>
</x-box>
