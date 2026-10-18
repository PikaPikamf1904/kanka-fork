<footer class="bg-dark text-light py-12 px-6">
    <div class="mx-auto lg:max-w-7xl flex flex-col gap-10">
        @if(config('tracking.consent'))
        <div data-cookie-consent-bar style="display: none;" class="rounded-lg border border-white/10 bg-white/5 p-4">
            <div class="flex flex-col gap-3 text-sm sm:flex-row sm:items-center">
                <p class="flex-1 text-white/70">
                    {{ __('cookieconsent.message') }}
                    <a href="{{ asset('privacypolicy.html') }}" target="_blank" class="text-blue-400 hover:underline">{{ __('cookieconsent.link') }}</a>
                </p>
                <div class="flex shrink-0 gap-2">
                    <button data-accept class="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700">{{ __('cookieconsent.allow') }}</button>
                    <button data-reject class="rounded border border-white/20 px-3 py-1 text-xs text-white/60 hover:border-white/40">{{ __('cookieconsent.reject') }}</button>
                </div>
            </div>
        </div>
        @endif
        <div class="flex flex-col items-center gap-4 text-center">
            <a href="{{ route('home') }}" class="text-white">
                <svg class="h-20 w-20" role="img" aria-label="{{ config('chronicle.name') }}">
                    <title>{{ config('chronicle.name') }}</title>
                    <use href="/images/svgs/sprites.svg#chronicle-logo"></use>
                </svg>
            </a>
            @include('layouts._credit', ['centered' => true])
        </div>
        <span data-ccpa-link="1"></span>
        <div id="ncmp-consent-link"></div>
    </div>
</footer>
