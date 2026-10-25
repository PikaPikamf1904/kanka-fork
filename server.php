<?php

/**
 * Laravel - A PHP Framework For Web Artisans
 *
 * @author   Taylor Otwell <taylor@laravel.com>
 */
$uri = urldecode(
    parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH)
);

// This file allows us to emulate Apache's "mod_rewrite" functionality from the
// built-in PHP web server. This provides a convenient way to test a Laravel
// application without having installed a "real" web server software here.
// Storage URLs must reach Laravel so StoredUploadController can apply ACLs,
// even when public/storage is a symlink to uploaded files.
$isStorageRequest = preg_match('#^/storage(?:/|$)#i', $uri) === 1;
if ($uri !== '/' && ! $isStorageRequest && file_exists(__DIR__ . '/public' . $uri)) {
    return false;
}

// The built-in server points SCRIPT_NAME at the requested file when it exists (an upload behind
// the public/storage symlink), so Laravel took the upload's URL as its base URL and routed the
// request to "/" instead of StoredUploadController. Everything here runs through index.php.
$_SERVER['SCRIPT_FILENAME'] = __DIR__ . '/public/index.php';
$_SERVER['SCRIPT_NAME'] = '/index.php';
$_SERVER['PHP_SELF'] = '/index.php';

require_once __DIR__ . '/public/index.php';
