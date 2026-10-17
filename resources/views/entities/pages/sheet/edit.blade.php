<?php
/**
 * @var \App\Models\Entity $entity
 * @var \App\Models\Campaign $campaign
 * @var array $fields
 * @var array $values
 */
use App\Services\CharacterSheets\CharacterSheetService;
use App\Services\CharacterSheets\Dnd2024Sheet;

// Stored text is cleaned HTML, so "&amp;" is shown back as "&" in the inputs.
$old = function (string $key) use ($values) {
    $value = old('fields.' . $key, $values[$key]);

    return is_string($value) ? html_entity_decode($value, ENT_QUOTES | ENT_HTML5, 'UTF-8') : $value;
};
$checked = fn (string $key) => filter_var(old('fields.' . $key, $values[$key]), FILTER_VALIDATE_BOOLEAN);
$selected = fn (string $key) => old('fields.' . $key, $values[$key] ?? $fields[$key]['options'][0]);
?>
@extends('layouts.app', [
    'title' => __('entities/sheet.edit.title', ['name' => $entity->name]),
    'description' => '',
    'breadcrumbs' => [
        Breadcrumb::campaign($campaign)->entity($entity)->list(),
        Breadcrumb::show(),
        __('entities/sheet.show.tab_name'),
    ],
    'mainTitle' => false,
    'centered' => true,
])

@section('content')
    @include('partials.errors')

    <x-form :action="['entities.sheet.update', $campaign, $entity]" method="PUT" unsaved class="character-sheet-form">
        <div class="flex flex-col gap-5">
            <x-box class="flex flex-col gap-3">
                <div class="flex gap-2 items-center">
                    <a href="{{ route('entities.sheet', [$campaign, $entity]) }}" class="btn2 btn-outline">
                        {{ __('crud.cancel') }}
                    </a>
                    <div class="grow text-right">
                        <button class="btn2 btn-primary">{{ __('crud.save') }}</button>
                    </div>
                </div>
                <p class="text-neutral-content text-sm m-0">{{ __('entities/sheet.helpers.edit') }}</p>
                <p class="text-neutral-content text-sm m-0">{{ __('entities/sheet.helpers.reference') }}</p>
            </x-box>

            <x-box class="flex flex-col gap-3">
                <h3 class="text-lg m-0 font-semibold">{{ __('entities/sheet.groups.identity') }}</h3>
                <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    @foreach (array_keys(Dnd2024Sheet::IDENTITY) as $key)
                        <x-forms.field :field="'sheet-' . $key" :label="$fields[$key]['base']" :id="'sheet-' . $key">
                            <input type="text" id="sheet-{{ $key }}" name="fields[{{ $key }}]" value="{{ $old($key) }}" maxlength="{{ CharacterSheetService::TEXT_LENGTH }}" />
                        </x-forms.field>
                    @endforeach
                    @foreach (['level', 'armor_class', 'speed'] as $key)
                        <x-forms.field :field="'sheet-' . $key" :label="$fields[$key]['base']" :id="'sheet-' . $key">
                            <input type="number" id="sheet-{{ $key }}" name="fields[{{ $key }}]" value="{{ $old($key) }}" min="{{ $fields[$key]['min'] }}" max="{{ $fields[$key]['max'] }}" step="1" inputmode="numeric" />
                        </x-forms.field>
                    @endforeach
                </div>
            </x-box>

            <x-box class="flex flex-col gap-3">
                <h3 class="text-lg m-0 font-semibold">{{ __('entities/sheet.groups.abilities') }}</h3>
                <p class="text-neutral-content text-sm m-0">{{ __('entities/sheet.helpers.saves') }}</p>
                <div class="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-4">
                    @foreach (Dnd2024Sheet::ABILITIES as $key => $name)
                        <div class="flex flex-col gap-2">
                            <x-forms.field :field="'sheet-' . $key" :label="$name" :id="'sheet-' . $key">
                                <input type="number" id="sheet-{{ $key }}" name="fields[{{ $key }}]" value="{{ $old($key) }}" min="{{ $fields[$key]['min'] }}" max="{{ $fields[$key]['max'] }}" step="1" inputmode="numeric" />
                            </x-forms.field>
                            <input type="hidden" name="fields[{{ $key }}_save]" value="0" />
                            <x-checkbox :text="$fields[$key . '_save']['base']">
                                <input type="checkbox" name="fields[{{ $key }}_save]" value="1" @if ($checked($key . '_save')) checked="checked" @endif />
                            </x-checkbox>
                        </div>
                    @endforeach
                </div>
            </x-box>

            <x-box class="flex flex-col gap-3">
                <h3 class="text-lg m-0 font-semibold">{{ __('entities/sheet.groups.skills') }}</h3>
                <p class="text-neutral-content text-sm m-0">{{ __('entities/sheet.helpers.skills') }}</p>
                <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    @foreach (Dnd2024Sheet::SKILLS as $key => [$name, $ability])
                        <x-forms.field :field="'sheet-' . $key" :label="$name . ' (' . mb_substr(Dnd2024Sheet::ABILITIES[$ability], 0, 3) . ')'" :id="'sheet-' . $key">
                            <select id="sheet-{{ $key }}" name="fields[{{ $key }}]" class="w-full">
                                @foreach (Dnd2024Sheet::TRAINING as $option)
                                    <option value="{{ $option }}" @if ($selected($key) === $option) selected="selected" @endif>{{ __('entities/sheet.training.' . $option) }}</option>
                                @endforeach
                            </select>
                        </x-forms.field>
                    @endforeach
                </div>
            </x-box>

            <x-box class="flex flex-col gap-3">
                <h3 class="text-lg m-0 font-semibold">{{ __('entities/sheet.groups.spellcasting') }}</h3>
                <x-forms.field field="sheet-spellcasting" :label="$fields['spellcasting']['base']" id="sheet-spellcasting">
                    <select id="sheet-spellcasting" name="fields[spellcasting]" class="w-full sm:w-1/2">
                        @foreach (Dnd2024Sheet::SPELLCASTING as $option)
                            <option value="{{ $option }}" @if ($selected('spellcasting') === $option) selected="selected" @endif>{{ $option }}</option>
                        @endforeach
                    </select>
                </x-forms.field>
            </x-box>

            <x-box class="flex flex-col gap-3">
                <h3 class="text-lg m-0 font-semibold">{{ __('entities/sheet.groups.notes') }}</h3>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    @foreach (array_keys(Dnd2024Sheet::NOTES) as $key)
                        <x-forms.field :field="'sheet-' . $key" :label="$fields[$key]['base']" :id="'sheet-' . $key">
                            <textarea id="sheet-{{ $key }}" name="fields[{{ $key }}]" rows="6" maxlength="{{ CharacterSheetService::BLOCK_LENGTH }}">{{ $old($key) }}</textarea>
                        </x-forms.field>
                    @endforeach
                </div>
            </x-box>

            <div class="text-right">
                <button class="btn2 btn-primary">{{ __('crud.save') }}</button>
            </div>
        </div>
    </x-form>
@endsection
