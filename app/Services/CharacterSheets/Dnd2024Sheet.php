<?php

namespace App\Services\CharacterSheets;

use App\Enums\AttributeType;

/**
 * The fields of a D&D 2024 reference sheet and the numbers derived from them. Every field is
 * stored as an ordinary property (attribute) of the character, so the sheet also shows up on
 * the Properties page, in exports and in the API. The sheet is a reference for the
 * encyclopedia: no hit point tracking, initiative, dice or death saves.
 *
 * The rules used here (ability modifiers, proficiency bonus, saves, skills, passive Perception,
 * spell save DC and spell attack bonus) come from the System Reference Document 5.2, see
 * lang/en/entities/sheet.php for the attribution.
 */
class Dnd2024Sheet
{
    public const string SECTION = 'Character sheet';

    public const array ABILITIES = [
        'strength' => 'Strength',
        'dexterity' => 'Dexterity',
        'constitution' => 'Constitution',
        'intelligence' => 'Intelligence',
        'wisdom' => 'Wisdom',
        'charisma' => 'Charisma',
    ];

    /** Skill => [name, ability] */
    public const array SKILLS = [
        'acrobatics' => ['Acrobatics', 'dexterity'],
        'animal_handling' => ['Animal Handling', 'wisdom'],
        'arcana' => ['Arcana', 'intelligence'],
        'athletics' => ['Athletics', 'strength'],
        'deception' => ['Deception', 'charisma'],
        'history' => ['History', 'intelligence'],
        'insight' => ['Insight', 'wisdom'],
        'intimidation' => ['Intimidation', 'charisma'],
        'investigation' => ['Investigation', 'intelligence'],
        'medicine' => ['Medicine', 'wisdom'],
        'nature' => ['Nature', 'intelligence'],
        'perception' => ['Perception', 'wisdom'],
        'performance' => ['Performance', 'charisma'],
        'persuasion' => ['Persuasion', 'charisma'],
        'religion' => ['Religion', 'intelligence'],
        'sleight_of_hand' => ['Sleight of Hand', 'dexterity'],
        'stealth' => ['Stealth', 'dexterity'],
        'survival' => ['Survival', 'wisdom'],
    ];

    /** Skill training, in the order of the multiplier applied to the proficiency bonus */
    public const array TRAINING = ['None', 'Proficient', 'Expertise'];

    public const array SPELLCASTING = ['None', 'Intelligence', 'Wisdom', 'Charisma'];

    public const array IDENTITY = [
        'class' => 'Class',
        'subclass' => 'Subclass',
        'species' => 'Species',
        'background' => 'Background',
        'alignment' => 'Alignment',
    ];

    public const array NOTES = [
        'languages' => 'Languages',
        'training' => 'Training and proficiencies',
        'features' => 'Features and traits',
        'equipment' => 'Equipment',
        'spells' => 'Spells',
        'backstory' => 'Backstory and personality',
    ];

    /**
     * Every field of the sheet, in the order they are created on a character.
     *
     * @return array<string, array{name: string, base: string, type: AttributeType, group: string, min?: int, max?: int, options?: array<int, string>}>
     */
    public function fields(): array
    {
        $fields = [];
        foreach (self::IDENTITY as $key => $name) {
            $fields[$key] = $this->field($name, AttributeType::Standard, 'identity');
        }
        $fields['level'] = $this->number('Level', 1, 20, 'identity');
        $fields['armor_class'] = $this->number('Armor Class', 0, 40, 'identity');
        $fields['speed'] = $this->number('Speed', 0, 240, 'identity');

        foreach (self::ABILITIES as $key => $name) {
            $fields[$key] = $this->number($name, 1, 30, 'abilities');
        }
        foreach (self::ABILITIES as $key => $name) {
            $fields[$key . '_save'] = $this->field($name . ' save', AttributeType::Checkbox, 'saves');
        }
        foreach (self::SKILLS as $key => [$name]) {
            $fields[$key] = $this->choice($name, self::TRAINING, 'skills');
        }
        $fields['spellcasting'] = $this->choice('Spellcasting ability', self::SPELLCASTING, 'spellcasting');

        foreach (self::NOTES as $key => $name) {
            $fields[$key] = $this->field($name, AttributeType::Block, 'notes');
        }

        return $fields;
    }

    /**
     * Everything the sheet derives from the stored values. A number is null when the score it
     * depends on hasn't been filled in.
     *
     * @param  array<string, mixed>  $values  field key => normalised value (see CharacterSheetService)
     */
    public function compute(array $values): array
    {
        $level = $values['level'] ?? null;
        $bonus = $this->proficiencyBonus($level === null ? 1 : (int) $level);

        $modifiers = [];
        $saves = [];
        foreach (array_keys(self::ABILITIES) as $ability) {
            $score = $values[$ability] ?? null;
            $modifiers[$ability] = $score === null ? null : $this->modifier((int) $score);
            $saves[$ability] = $modifiers[$ability] === null
                ? null
                : $modifiers[$ability] + (! empty($values[$ability . '_save']) ? $bonus : 0);
        }

        $skills = [];
        foreach (self::SKILLS as $skill => [, $ability]) {
            $skills[$skill] = $modifiers[$ability] === null
                ? null
                : $modifiers[$ability] + $this->trainingMultiplier($values[$skill] ?? null) * $bonus;
        }

        $spellAbility = mb_strtolower((string) ($values['spellcasting'] ?? ''));
        $spellModifier = $modifiers[$spellAbility] ?? null;

        return [
            'proficiency_bonus' => $bonus,
            'modifiers' => $modifiers,
            'saves' => $saves,
            'skills' => $skills,
            'passive_perception' => $skills['perception'] === null ? null : 10 + $skills['perception'],
            'spell_save_dc' => $spellModifier === null ? null : 8 + $bonus + $spellModifier,
            'spell_attack' => $spellModifier === null ? null : $bonus + $spellModifier,
        ];
    }

    public function modifier(int $score): int
    {
        return (int) floor(($score - 10) / 2);
    }

    public function proficiencyBonus(int $level): int
    {
        $level = max(1, min(20, $level));

        return 2 + intdiv($level - 1, 4);
    }

    public function trainingMultiplier(?string $training): int
    {
        $index = array_search($training, self::TRAINING, true);

        return $index === false ? 0 : $index;
    }

    /**
     * Show a modifier with its sign, like +3 or −1.
     */
    public static function signed(?int $value): string
    {
        if ($value === null) {
            return '—';
        }

        return ($value < 0 ? '−' : '+') . abs($value);
    }

    protected function field(string $name, AttributeType $type, string $group): array
    {
        return ['name' => $name, 'base' => $name, 'type' => $type, 'group' => $group];
    }

    /**
     * Number properties named like "Level[range:1,20]" are clamped by Kanka itself.
     */
    protected function number(string $name, int $min, int $max, string $group): array
    {
        return [
            'name' => "{$name}[range:{$min},{$max}]",
            'base' => $name,
            'type' => AttributeType::Number,
            'group' => $group,
            'min' => $min,
            'max' => $max,
        ];
    }

    /**
     * Standard properties named like "Athletics[range:None,Proficient,Expertise]" are shown as a
     * list by Kanka, which empties any value outside of it.
     */
    protected function choice(string $name, array $options, string $group): array
    {
        return [
            'name' => $name . '[range:' . implode(',', $options) . ']',
            'base' => $name,
            'type' => AttributeType::Standard,
            'group' => $group,
            'options' => $options,
        ];
    }
}
