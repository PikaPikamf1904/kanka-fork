<?php
/**
 * @var \App\Models\Entity $entity
 * @var \App\Models\Campaign $campaign
 * @var \App\Services\CharacterSheets\Dnd2024Sheet $sheet
 * @var array $fields
 * @var array<string, ?\App\Models\Attribute> $attributes
 * @var array $values
 * @var array $computed
 */
use App\Services\CharacterSheets\Dnd2024Sheet;

// Text is shown like on the Properties tab (with mentions), cleaned again as properties saved
// through the API aren't.
$text = function (string $key) use ($attributes, $values): string {
    $attribute = $attributes[$key] ?? null;
    if ($attribute === null || $values[$key] === null) {
        return '<span class="text-neutral-content">—</span>';
    }
    $value = $attribute->mappedValue();

    return Purify::clean($attribute->isText() ? nl2br($value) : $value);
};
$number = fn (string $key) => $values[$key] === null ? '—' : (string) $values[$key];
$identity = array_keys(Dnd2024Sheet::IDENTITY);
?>
<div class="character-sheet flex flex-col gap-5 print:gap-3" data-sheet="dnd2024">
    @if (empty(array_filter($attributes)))
        <x-box>
            <p class="m-0">{{ __('entities/sheet.empty') }}</p>
        </x-box>
    @endif

    <x-box class="character-sheet-identity print:shadow-none">
        <h3 class="text-lg m-0 mb-3 font-semibold">{{ __('entities/sheet.groups.identity') }}</h3>
        <dl class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 m-0">
            @foreach ($identity as $key)
                <div class="flex flex-col gap-0.5 min-w-0" data-field="{{ $key }}">
                    <dt class="text-xs uppercase tracking-wide text-neutral-content">{{ $fields[$key]['base'] }}</dt>
                    <dd class="m-0 break-words">{!! $text($key) !!}</dd>
                </div>
            @endforeach
            @foreach (['level', 'armor_class', 'speed'] as $key)
                <div class="flex flex-col gap-0.5" data-field="{{ $key }}">
                    <dt class="text-xs uppercase tracking-wide text-neutral-content">{{ $fields[$key]['base'] }}</dt>
                    <dd class="m-0 text-xl font-semibold">{{ $number($key) }}</dd>
                </div>
            @endforeach
            <div class="flex flex-col gap-0.5" data-field="proficiency_bonus">
                <dt class="text-xs uppercase tracking-wide text-neutral-content">{{ __('entities/sheet.computed.proficiency_bonus') }}</dt>
                <dd class="m-0 text-xl font-semibold">{{ Dnd2024Sheet::signed($computed['proficiency_bonus']) }}</dd>
            </div>
        </dl>
    </x-box>

    <section class="character-sheet-abilities" aria-labelledby="sheet-abilities">
        <h3 id="sheet-abilities" class="text-lg m-0 mb-3 font-semibold">{{ __('entities/sheet.groups.abilities') }}</h3>
        <div class="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3 print:grid-cols-6">
            @foreach (Dnd2024Sheet::ABILITIES as $ability => $name)
                <div class="rounded-lg bg-box shadow-xs p-3 flex flex-col items-center gap-1 text-center print:shadow-none print:border" data-ability="{{ $ability }}">
                    <span class="text-xs uppercase tracking-wide text-neutral-content">{{ $name }}</span>
                    <span class="text-3xl font-bold" title="{{ __('entities/sheet.computed.modifier') }}">{{ Dnd2024Sheet::signed($computed['modifiers'][$ability]) }}</span>
                    <span class="rounded-full border px-3 text-sm">{{ $number($ability) }}</span>
                    <span class="text-xs flex items-center gap-1 mt-1">
                        @if ($values[$ability . '_save'])
                            <x-icon class="fa-solid fa-circle text-accent" :title="__('entities/sheet.training.Proficient')" />
                        @else
                            <x-icon class="fa-regular fa-circle text-neutral-content" />
                        @endif
                        {{ __('entities/sheet.computed.save') }}
                        <strong data-save="{{ $ability }}">{{ Dnd2024Sheet::signed($computed['saves'][$ability]) }}</strong>
                    </span>
                </div>
            @endforeach
        </div>
    </section>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-5 print:grid-cols-2">
        <x-box class="character-sheet-skills print:shadow-none">
            <h3 class="text-lg m-0 mb-1 font-semibold">{{ __('entities/sheet.groups.skills') }}</h3>
            <p class="text-xs text-neutral-content m-0 mb-3 print:hidden">{{ __('entities/sheet.helpers.skills') }}</p>
            <ul class="m-0 p-0 list-none flex flex-col">
                @foreach (Dnd2024Sheet::SKILLS as $skill => [$name, $ability])
                    <li class="flex items-center gap-2 py-1 border-b last:border-b-0 border-base-300" data-skill="{{ $skill }}">
                        @if ($values[$skill] === 'Expertise')
                            <x-icon class="fa-solid fa-circle-dot text-accent" :title="__('entities/sheet.training.Expertise')" />
                        @elseif ($values[$skill] === 'Proficient')
                            <x-icon class="fa-solid fa-circle text-accent" :title="__('entities/sheet.training.Proficient')" />
                        @else
                            <x-icon class="fa-regular fa-circle text-neutral-content" />
                        @endif
                        <span class="grow">{{ $name }} <span class="text-xs text-neutral-content">({{ mb_substr(Dnd2024Sheet::ABILITIES[$ability], 0, 3) }})</span></span>
                        <strong class="w-10 text-right">{{ Dnd2024Sheet::signed($computed['skills'][$skill]) }}</strong>
                    </li>
                @endforeach
            </ul>
        </x-box>

        <div class="flex flex-col gap-5 print:gap-3">
            <x-box class="character-sheet-senses print:shadow-none">
                <dl class="grid grid-cols-1 sm:grid-cols-3 md:grid-cols-1 lg:grid-cols-3 gap-3 m-0">
                    <div class="flex flex-col gap-0.5" data-computed="passive_perception">
                        <dt class="text-xs uppercase tracking-wide text-neutral-content">{{ __('entities/sheet.computed.passive_perception') }}</dt>
                        <dd class="m-0 text-xl font-semibold">{{ $computed['passive_perception'] ?? '—' }}</dd>
                    </div>
                    <div class="flex flex-col gap-0.5" data-computed="spell_save_dc">
                        <dt class="text-xs uppercase tracking-wide text-neutral-content">{{ __('entities/sheet.computed.spell_save_dc') }}</dt>
                        <dd class="m-0 text-xl font-semibold">{{ $computed['spell_save_dc'] ?? '—' }}</dd>
                    </div>
                    <div class="flex flex-col gap-0.5" data-computed="spell_attack">
                        <dt class="text-xs uppercase tracking-wide text-neutral-content">{{ __('entities/sheet.computed.spell_attack') }}</dt>
                        <dd class="m-0 text-xl font-semibold">{{ Dnd2024Sheet::signed($computed['spell_attack']) }}</dd>
                    </div>
                </dl>
                <p class="text-xs text-neutral-content m-0 mt-3">
                    {{ $fields['spellcasting']['base'] }}: {{ $values['spellcasting'] ?? __('entities/sheet.training.None') }}
                </p>
            </x-box>

            @foreach (['languages', 'training'] as $key)
                <x-box class="print:shadow-none" data-field="{{ $key }}">
                    <h3 class="text-lg m-0 mb-2 font-semibold">{{ $fields[$key]['base'] }}</h3>
                    <div class="break-words">{!! $text($key) !!}</div>
                </x-box>
            @endforeach
        </div>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-5 print:block">
        @foreach (['features', 'equipment', 'spells', 'backstory'] as $key)
            <x-box class="print:shadow-none print:mb-3" data-field="{{ $key }}">
                <h3 class="text-lg m-0 mb-2 font-semibold">{{ $fields[$key]['base'] }}</h3>
                <div class="break-words">{!! $text($key) !!}</div>
            </x-box>
        @endforeach
    </div>

    <p class="text-xs text-neutral-content m-0 character-sheet-attribution">{{ __('entities/sheet.attribution') }}</p>
</div>
