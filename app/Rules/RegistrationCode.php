<?php

namespace App\Rules;

use Closure;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Translation\PotentiallyTranslatedString;

class RegistrationCode implements ValidationRule
{
    /**
     * Run the validation rule.
     *
     * @param  Closure(string): PotentiallyTranslatedString  $fail
     */
    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        $code = (string) config('auth.register_code');
        // Constant-time comparison so response times do not leak the code
        if ($code === '' || ! is_string($value) || ! hash_equals($code, trim($value))) {
            $fail(__('auth.register.errors.code'));
        }
    }
}
