<?php

it('goes back to the page the settings were opened from', function () {
    $this->asUser();
    $from = route('settings.appearance', ['highlight' => 'pagination']);

    $this->patch(route('settings.appearance.update'), ['theme' => 'dark', 'from' => base64_encode($from)])
        ->assertRedirect($from);
});

it('does not send the user to another site after saving', function (string $from) {
    $this->asUser();

    $this->patch(route('settings.appearance.update'), ['theme' => 'dark', 'from' => base64_encode($from)])
        ->assertRedirect(route('settings.appearance'));

    expect(auth()->user()->fresh()->theme)->toBe('dark');
})->with([
    'https://evil.example/login',
    '//evil.example/login',
    'http://localhost.evil.example/',
    'javascript:alert(1)',
    'not base64 at all',
]);
