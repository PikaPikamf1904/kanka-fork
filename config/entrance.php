<?php

/*
 * Shared-password entrance: a gate in front of the site for visitors who are not logged in.
 * It never logs anyone in and grants no permissions; see docs / deploy README.
 */
return [
    'enabled' => (bool) env('ENTRANCE_ENABLED', false),

    'remember_days' => (int) env('ENTRANCE_REMEMBER_DAYS', 30),

    // User ids who may change the entrance password from the web (comma separated in the env).
    'managers' => array_values(array_map(
        'intval',
        array_filter(
            array_map('trim', explode(',', (string) env('ENTRANCE_MANAGER_IDS', ''))),
            fn (string $id) => $id !== '' && ctype_digit($id)
        )
    )),

    'store' => storage_path('app/entrance/entrance.json'),

    'cookie' => 'chronicle_entrance',

    'min_length' => 10,
];
