<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex,nofollow">
    <title>{{ config('chronicle.name', config('app.name')) }}</title>
    <link rel="icon" href="/images/favicon/favicon.svg">
    <style>
        :root { --parchment: #f4ecd8; --paper: #fbf6e8; --ink: #2b2118; --ink-soft: #5a4a3a; --rule: #c9b995; --accent: #6b2d1a; --error: #8a1c1c; }
        * { box-sizing: border-box; }
        html, body { margin: 0; min-height: 100%; }
        body { background: var(--parchment); color: var(--ink); font: 18px/1.5 Georgia, "Times New Roman", serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 16px; }
        main { width: 100%; max-width: 26rem; background: var(--paper); border: 1px solid var(--rule); border-radius: 6px; padding: 2rem 1.75rem; box-shadow: 0 2px 12px rgba(43, 33, 24, .12); }
        h1 { margin: 0 0 1.25rem; font-size: 2rem; line-height: 1.2; text-align: center; font-weight: normal; letter-spacing: .02em; }
        label { display: block; margin-bottom: .35rem; font-weight: bold; }
        input[type=password] { width: 100%; padding: .7rem .75rem; font-size: 1.1rem; border: 1px solid var(--ink-soft); border-radius: 4px; background: #fff; color: var(--ink); }
        button { margin-top: 1.1rem; width: 100%; padding: .75rem 1rem; font: inherit; font-size: 1.1rem; background: var(--accent); color: #fff; border: 0; border-radius: 4px; cursor: pointer; }
        button:hover, button:focus { background: #4f2112; }
        button:disabled, input:disabled { opacity: .55; cursor: not-allowed; }
        :focus-visible { outline: 3px solid #1f5fa8; outline-offset: 2px; }
        .error { margin: 0 0 1rem; padding: .6rem .75rem; color: var(--error); background: #fdeeee; border: 1px solid #e3b4b4; border-radius: 4px; font-size: 1rem; }
        .notice { margin: 0 0 1rem; color: var(--ink-soft); text-align: center; }
    </style>
</head>
<body>
<main>
    <h1>{{ config('chronicle.name', config('app.name')) }}</h1>

    @if (! ($configured ?? false))
        <p class="notice" role="status">{{ __('entrance.not_configured') }}</p>
    @endif

    @if (! empty($throttled))
        <p class="error" role="alert">{{ __('entrance.throttled') }}</p>
    @elseif (isset($errors) && $errors->has('password'))
        <p class="error" role="alert">{{ $errors->first('password') }}</p>
    @endif

    <form method="POST" action="{{ route('entrance.enter') }}">
        @csrf
        <label for="entrance-password">{{ __('entrance.password') }}</label>
        <input id="entrance-password" type="password" name="password" autocomplete="current-password" required autofocus @disabled(! ($configured ?? false))>
        <button type="submit" @disabled(! ($configured ?? false))>{{ __('entrance.submit') }}</button>
    </form>
</main>
</body>
</html>
