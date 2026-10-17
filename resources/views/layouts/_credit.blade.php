<div class="chronicle-credit text-xs text-neutral-content flex flex-col gap-1 @if (!empty($centered)) text-center @endif">
    <p>
        {{ config('chronicle.name') }} &middot; built on <a href="{{ config('chronicle.credit_url') }}" class="text-link" target="_blank" rel="noopener">Kanka</a>, {!! __('footer.copyright', ['copy' => '&copy;', 'year' => date('Y'), 'company' => 'Owlchester SNC']) !!}
    </p>
</div>
