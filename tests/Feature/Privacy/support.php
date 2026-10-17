<?php

/*
 * Fixtures and helpers shared by the privacy tests. Not a test file itself: each test file
 * that needs these loads it with require_once.
 */

use App\Enums\EntityAssetType;
use App\Enums\Visibility;
use App\Models\Attribute;
use App\Models\CampaignRoleUser;
use App\Models\CampaignUser;
use App\Models\Character;
use App\Models\EntityAsset;
use App\Models\Post;
use App\Models\Relation;
use App\Models\User;
use Laravel\Passport\Passport;

/**
 * A campaign with one public character ("Harbor Watch") and DM-only content around it.
 *
 * @return array<string, mixed>
 */
function dmOnlyFixture(): array
{
    $public = Character::factory()->create([
        'campaign_id' => 1,
        'name' => 'Harbor Watch',
    ])->entity;

    $hidden = Character::factory()->create([
        'campaign_id' => 1,
        'name' => 'dmonly-hidden-villain',
        'is_private' => true,
    ])->entity;
    $hidden->update(['is_private' => true]);

    $ally = Character::factory()->create(['campaign_id' => 1, 'name' => 'Lighthouse Keeper'])->entity;

    $public->update(['entry' => '<p>The watch reports to [character:' . $hidden->id . '] and [character:' . $ally->id . '].</p>']);

    Post::factory()->create([
        'entity_id' => $public->id,
        'name' => 'Player-visible note',
        'entry' => '<p>Anyone in the campaign can read this.</p>',
        'visibility_id' => Visibility::All,
    ]);
    Post::factory()->create([
        'entity_id' => $public->id,
        'name' => 'dmonly-post-title',
        'entry' => '<p>dmonly-post-entry</p>',
        'visibility_id' => Visibility::Admin,
    ]);

    Attribute::factory()->create([
        'entity_id' => $public->id,
        'name' => 'Rank',
        'value' => 'Sergeant',
        'is_private' => false,
    ]);
    Attribute::factory()->create([
        'entity_id' => $public->id,
        'name' => 'dmonly-attribute-name',
        'value' => 'dmonly-attribute-value',
        'is_private' => true,
    ]);

    Relation::factory()->create([
        'campaign_id' => 1,
        'owner_id' => $public->id,
        'target_id' => $ally->id,
        'relation' => 'dmonly-secret-relation',
        'visibility_id' => Visibility::Admin,
    ]);
    Relation::factory()->create([
        'campaign_id' => 1,
        'owner_id' => $public->id,
        'target_id' => $hidden->id,
        'relation' => 'dmonly-relation-to-hidden',
        'visibility_id' => Visibility::All,
    ]);

    EntityAsset::factory()->create([
        'entity_id' => $public->id,
        'type_id' => EntityAssetType::alias,
        'name' => 'Harbor Patrol',
        'visibility_id' => Visibility::All,
    ]);
    EntityAsset::factory()->create([
        'entity_id' => $public->id,
        'type_id' => EntityAssetType::alias,
        'name' => 'dmonly-alias',
        'visibility_id' => Visibility::Admin,
    ]);
    $link = EntityAsset::factory()->create([
        'entity_id' => $public->id,
        'type_id' => EntityAssetType::link,
        'name' => 'dmonly-link',
        'metadata' => ['url' => 'https://example.com/dmonly-link-target'],
        'visibility_id' => Visibility::Admin,
    ]);
    EntityAsset::factory()->create([
        'entity_id' => $public->id,
        'type_id' => EntityAssetType::file,
        'name' => 'dmonly-file',
        'metadata' => ['path' => 'entities/files/dmonly-file.pdf', 'type' => 'application/pdf', 'size' => 10],
        'visibility_id' => Visibility::Admin,
    ]);

    return compact('public', 'hidden', 'ally', 'link');
}

function dmOnlyPlayer(): void
{
    $player = User::factory()->create(['id' => 7201]);
    CampaignUser::create(['campaign_id' => 1, 'user_id' => $player->id]);
    CampaignRoleUser::create(['campaign_role_id' => 3, 'user_id' => $player->id]);
    Passport::actingAs($player, ['*']);
}

function dmOnlyAdmin(): void
{
    Passport::actingAs(User::find(1), ['*']);
}

function expectNoDmOnlyText($response, string $where = ''): void
{
    $content = (string) $response->getContent();
    $at = mb_strpos($content, 'dmonly-');
    $context = $at === false ? '' : mb_substr($content, max(0, $at - 300), 400);
    expect($at)->toBeFalse(mb_trim($where . ' leaked DM-only text: ' . $context));
}
