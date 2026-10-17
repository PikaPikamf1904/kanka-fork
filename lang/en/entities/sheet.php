<?php

return [
    'actions'   => [
        'edit'  => 'Edit sheet',
        'print' => 'Print sheet',
    ],
    'attribution'   => 'This work includes material from the System Reference Document 5.2 ("SRD 5.2") by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2 is licensed under the Creative Commons Attribution 4.0 International License, available at https://creativecommons.org/licenses/by/4.0/legalcode.',
    'computed'  => [
        'modifier'              => 'Modifier',
        'passive_perception'    => 'Passive Perception',
        'proficiency_bonus'     => 'Proficiency bonus',
        'save'                  => 'Save',
        'spell_attack'          => 'Spell attack bonus',
        'spell_save_dc'         => 'Spell save DC',
    ],
    'edit'      => [
        'title' => 'Edit :name\'s sheet',
    ],
    'empty'     => 'This character doesn\'t have a sheet yet.',
    'groups'    => [
        'abilities'     => 'Abilities',
        'identity'      => 'Character',
        'notes'         => 'Notes',
        'saves'         => 'Saving throw proficiencies',
        'skills'        => 'Skills',
        'spellcasting'  => 'Spellcasting',
    ],
    'helpers'   => [
        'edit'      => 'The sheet is saved as the character\'s properties, so it also shows on the Properties tab and in exports. Leave a field empty to keep it off the sheet.',
        'reference' => 'A reference sheet for the encyclopedia. Track hit points, initiative and rolls at the table.',
        'saves'     => 'Check the saving throws the character is proficient in.',
        'skills'    => 'Proficient adds the proficiency bonus, Expertise adds it twice.',
    ],
    'show'      => [
        'tab_name'  => 'Sheet',
        'title'     => ':name\'s sheet',
    ],
    'training'  => [
        'Expertise'     => 'Expertise',
        'None'          => 'None',
        'Proficient'    => 'Proficient',
    ],
    'update'    => [
        'success'   => ':name\'s sheet was saved.',
    ],
];
