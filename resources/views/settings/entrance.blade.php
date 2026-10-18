<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex,nofollow">
    <title>{{ __('entrance.settings.title') }}</title>
    <link rel="icon" href="/images/favicon/favicon.svg">
    <style>
        body { background: #f4ecd8; color: #2b2118; font: 17px/1.5 Georgia, serif; margin: 0; padding: 16px; }
        main { max-width: 34rem; margin: 2rem auto; background: #fbf6e8; border: 1px solid #c9b995; border-radius: 6px; padding: 1.5rem; }
        h1 { font-weight: normal; margin-top: 0; }
        dl { display: grid; grid-template-columns: max-content 1fr; gap: .25rem 1rem; }
        dt { font-weight: bold; } dd { margin: 0; }
        label { display: block; margin: 1rem 0 .3rem; font-weight: bold; }
        input[type=password] { width: 100%; box-sizing: border-box; padding: .6rem; font-size: 1rem; border: 1px solid #5a4a3a; border-radius: 4px; }
        button { margin-top: 1rem; padding: .65rem 1.2rem; font: inherit; background: #6b2d1a; color: #fff; border: 0; border-radius: 4px; cursor: pointer; }
        .error { color: #8a1c1c; margin: .3rem 0 0; } .status { color: #1f5a2a; font-weight: bold; }
        .hint { color: #5a4a3a; font-size: .95rem; }
    </style>
</head>
<body>
<main>
    <h1>{{ __('entrance.settings.title') }}</h1>

    @if (session('status'))
        <p class="status" role="status">{{ session('status') }}</p>
    @endif

    <dl>
        <dt>{{ __('entrance.settings.enabled') }}</dt>
        <dd>{{ $enabled ? __('entrance.settings.yes') : __('entrance.settings.no') }}</dd>
        <dt>{{ __('entrance.settings.configured') }}</dt>
        <dd>{{ $configured ? __('entrance.settings.yes') : __('entrance.settings.no') }}</dd>
        <dt>{{ __('entrance.settings.changed') }}</dt>
        <dd>{{ $updatedAt ? $updatedAt->toDayDateTimeString() : __('entrance.settings.never') }}</dd>
    </dl>

    <form method="POST" action="{{ route('settings.entrance.update') }}">
        @csrf
        <label for="password">{{ __('entrance.settings.new') }}</label>
        <input id="password" type="password" name="password" autocomplete="new-password" required minlength="{{ $minLength }}" maxlength="200">
        @error('password')<p class="error" role="alert">{{ $message }}</p>@enderror

        <label for="password_confirmation">{{ __('entrance.settings.confirm') }}</label>
        <input id="password_confirmation" type="password" name="password_confirmation" autocomplete="new-password" required maxlength="200">

        <p class="hint">{{ __('entrance.settings.hint', ['min' => $minLength]) }}</p>
        <button type="submit">{{ __('entrance.settings.save') }}</button>
    </form>
</main>
</body>
</html>
