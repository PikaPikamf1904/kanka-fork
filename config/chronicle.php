<?php

return [
    /*
    |--------------------------------------------------------------------------
    | Site identity
    |--------------------------------------------------------------------------
    | The name shown in the interface, page titles, emails and the logo's accessible
    | label. This is independent of APP_NAME, which feeds the session cookie and the
    | cache prefix and must not be changed on a running install.
    */
    'name' => env('CHRONICLE_NAME', 'Chronicle'),
    'tagline' => env('CHRONICLE_TAGLINE', 'A campaign encyclopedia'),

    /*
    |--------------------------------------------------------------------------
    | Hide promotions
    |--------------------------------------------------------------------------
    | Hides pure advertising and links to the upstream service (pricing, premium,
    | newsletter, blog, plugins, Discord, roadmap, status, ad slots, trial banner...).
    | This only changes what is displayed. It never changes what a user is allowed to do.
    */
    'hide_promotions' => (bool) env('CHRONICLE_HIDE_PROMOTIONS', true),

    /*
    |--------------------------------------------------------------------------
    | Credit
    |--------------------------------------------------------------------------
    | Chronicle is built on the open-source Kanka codebase (AGPL-3.0, Owlchester SNC).
    */
    'credit_url' => 'https://github.com/owlchester/kanka',
];
