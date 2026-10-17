<?php

use App\Enums\AttributeType;
use App\Services\CharacterSheets\Dnd2024Sheet;

it('computes ability modifiers', function (int $score, int $modifier) {
    expect((new Dnd2024Sheet)->modifier($score))->toBe($modifier);
})->with([
    [1, -5],
    [3, -4],
    [8, -1],
    [9, -1],
    [10, 0],
    [11, 0],
    [12, 1],
    [15, 2],
    [20, 5],
    [30, 10],
]);

it('computes the proficiency bonus by level', function (int $level, int $bonus) {
    expect((new Dnd2024Sheet)->proficiencyBonus($level))->toBe($bonus);
})->with([
    [0, 2],
    [1, 2],
    [4, 2],
    [5, 3],
    [8, 3],
    [9, 4],
    [13, 5],
    [16, 5],
    [17, 6],
    [20, 6],
    [25, 6],
]);

it('derives saves, skills and spellcasting from the scores', function () {
    $computed = (new Dnd2024Sheet)->compute([
        'level' => 5,
        'strength' => 16,
        'dexterity' => 14,
        'constitution' => 13,
        'intelligence' => 8,
        'wisdom' => 12,
        'charisma' => 10,
        'strength_save' => true,
        'constitution_save' => true,
        'athletics' => 'Proficient',
        'perception' => 'Expertise',
        'stealth' => null,
        'spellcasting' => 'Wisdom',
    ]);

    expect($computed['proficiency_bonus'])->toBe(3)
        ->and($computed['modifiers'])->toBe([
            'strength' => 3,
            'dexterity' => 2,
            'constitution' => 1,
            'intelligence' => -1,
            'wisdom' => 1,
            'charisma' => 0,
        ])
        ->and($computed['saves']['strength'])->toBe(6)
        ->and($computed['saves']['constitution'])->toBe(4)
        ->and($computed['saves']['dexterity'])->toBe(2)
        ->and($computed['skills']['athletics'])->toBe(6)
        ->and($computed['skills']['perception'])->toBe(7)
        ->and($computed['skills']['stealth'])->toBe(2)
        ->and($computed['skills']['arcana'])->toBe(-1)
        ->and($computed['passive_perception'])->toBe(17)
        ->and($computed['spell_save_dc'])->toBe(12)
        ->and($computed['spell_attack'])->toBe(4);
});

it('leaves numbers empty when their score is missing', function () {
    $computed = (new Dnd2024Sheet)->compute(['strength' => 12]);

    expect($computed['proficiency_bonus'])->toBe(2)
        ->and($computed['modifiers']['strength'])->toBe(1)
        ->and($computed['modifiers']['wisdom'])->toBeNull()
        ->and($computed['saves']['wisdom'])->toBeNull()
        ->and($computed['skills']['perception'])->toBeNull()
        ->and($computed['passive_perception'])->toBeNull()
        ->and($computed['spell_save_dc'])->toBeNull()
        ->and($computed['spell_attack'])->toBeNull();
});

it('has no spell numbers without a spellcasting ability', function () {
    $computed = (new Dnd2024Sheet)->compute(['wisdom' => 18, 'spellcasting' => 'None']);

    expect($computed['spell_save_dc'])->toBeNull()
        ->and($computed['spell_attack'])->toBeNull();
});

it('shows modifiers with their sign', function () {
    expect(Dnd2024Sheet::signed(3))->toBe('+3')
        ->and(Dnd2024Sheet::signed(0))->toBe('+0')
        ->and(Dnd2024Sheet::signed(-1))->toBe('−1')
        ->and(Dnd2024Sheet::signed(null))->toBe('—');
});

it('names ranged fields so Kanka keeps them in range', function () {
    $fields = (new Dnd2024Sheet)->fields();

    expect($fields['level']['name'])->toBe('Level[range:1,20]')
        ->and($fields['level']['type'])->toBe(AttributeType::Number)
        ->and($fields['strength']['name'])->toBe('Strength[range:1,30]')
        ->and($fields['athletics']['name'])->toBe('Athletics[range:None,Proficient,Expertise]')
        ->and($fields['athletics']['type'])->toBe(AttributeType::Standard)
        ->and($fields['wisdom_save']['type'])->toBe(AttributeType::Checkbox)
        ->and($fields['backstory']['type'])->toBe(AttributeType::Block);
});

it('is a reference sheet, not a combat tracker', function () {
    $keys = implode(' ', array_keys((new Dnd2024Sheet)->fields()));

    foreach (['hit_points', 'hp', 'initiative', 'death', 'dice', 'roll'] as $tracker) {
        expect($keys)->not->toContain($tracker);
    }
});
