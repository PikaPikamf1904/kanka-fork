<?php

namespace App\Http\Requests;

use App\Enums\UserTheme;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreSettingsLayout extends FormRequest
{
    /**
     * Determine if the user is authorized to make this request.
     *
     * @return bool
     */
    public function authorize()
    {
        return true;
    }

    /**
     * Get the validation rules that apply to the request.
     *
     * @return array
     */
    public function rules()
    {
        return [
            'date_format' => 'nullable|string|max:5',
            'theme' => ['nullable', Rule::in(UserTheme::values())],
            //            'editor' => 'in:,summernote,markdown',
        ];
    }
}
