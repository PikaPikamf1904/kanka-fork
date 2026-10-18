<x-dialog.header>
    {{ config('chronicle.hide_promotions') ? __('callouts.premium.unavailable') : ($title ?? __('concept.premium-feature')) }}
</x-dialog.header>
<x-dialog.article class="max-w-xl">
    @unless (config('chronicle.hide_promotions'))
    <x-grid type="1/1">
        <p>{!! $pitch !!}</p>
    </x-grid>
    @endunless
</x-dialog.article>
<x-premium-cta-footer :campaign="$campaign" />
