<link rel="icon" type="image/svg+xml" href="{{ asset('/images/favicon/favicon.svg') }}" />
<link rel="icon" type="image/png" sizes="32x32" href="{{ asset('/images/favicon/favicon-32x32.png') }}">
<link rel="icon" type="image/png" sizes="16x16" href="{{ asset('/images/favicon/favicon-16x16.png') }}">
<link rel="shortcut icon" href="{{ asset('/favicon.ico') }}" />
<link rel="apple-touch-icon" href="{{ asset('/images/favicon/apple-touch-icon.png') }}" />
<link rel="manifest" href="{{ asset('/images/favicon/site.webmanifest') }}" />

<meta name="apple-mobile-web-app-title" content="{{ $campaign->name ?? config('chronicle.name') }}">
<meta name="apple-mobile-web-app-status-bar-style" content="#1f3a5f">
<meta name="theme-color" content="#1f3a5f">
