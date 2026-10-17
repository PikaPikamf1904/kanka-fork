<?php

namespace App\Enums;

/**
 * The themes a user can pick in their appearance settings. Each one is a stylesheet in
 * resources/css/themes built by Vite; no theme means light.
 */
enum UserTheme: string
{
    case Dark = 'dark';
    case Midnight = 'midnight';
    case Chronicle = 'chronicle';

    /**
     * @return string[]
     */
    public static function values(): array
    {
        return array_column(self::cases(), 'value');
    }
}
