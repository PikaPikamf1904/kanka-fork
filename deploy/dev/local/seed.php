<?php

// Synthetic campaign for local development: a DM, a player and a small invented world.
// Invented names only. Run once, after migrations and the default seeders, with DM_PASSWORD and
// PLAYER_PASSWORD set (deploy/dev/local/serve.sh does this).

use App\Enums\Visibility;
use App\Facades\CampaignLocalization;
use App\Models\Campaign;
use App\Models\CampaignPermission;
use App\Models\CampaignRole;
use App\Models\CampaignRoleUser;
use App\Models\CampaignSetting;
use App\Models\CampaignUser;
use App\Models\Character;
use App\Models\EntityType;
use App\Models\Location;
use App\Models\Organisation;
use App\Models\Relation;
use App\Models\User;
use Illuminate\Support\Facades\Hash;

require '/app/vendor/autoload.php';
$app = require '/app/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

$dm = User::factory()->create([
    'name' => 'Dev DM',
    'email' => 'dm@chronicle.test',
    'password' => Hash::make((string) getenv('DM_PASSWORD')),
    'theme' => 'chronicle',
]);
$player = User::factory()->create([
    'name' => 'Dev Player',
    'email' => 'player@chronicle.test',
    'password' => Hash::make((string) getenv('PLAYER_PASSWORD')),
]);

$campaign = Campaign::factory()->create([
    'name' => 'Silverfen Vale',
    'slug' => 'silverfen-vale',
    'entity_visibility' => false,
    'created_by' => $dm->id,
]);
CampaignLocalization::forceCampaign($campaign);
// The same per-campaign services the test helper primes before creating entities.
foreach ([
    App\Facades\EntityCache::class, App\Facades\CampaignCache::class, App\Facades\UserCache::class,
    App\Facades\Mentions::class, App\Facades\Module::class, App\Facades\QuestCache::class,
    App\Facades\BookmarkCache::class, App\Facades\EntityAssetCache::class,
    App\Facades\TimelineElementCache::class, App\Facades\CharacterCache::class,
    App\Facades\MapMarkerCache::class, App\Facades\Avatar::class,
] as $facade) {
    $facade::campaign($campaign);
}
auth()->setUser($dm);

CampaignUser::create(['campaign_id' => $campaign->id, 'user_id' => $dm->id]);
CampaignUser::create(['campaign_id' => $campaign->id, 'user_id' => $player->id]);

$admin = CampaignRole::create(['campaign_id' => $campaign->id, 'name' => 'Admin', 'is_admin' => true]);
CampaignRole::create(['campaign_id' => $campaign->id, 'name' => 'Public', 'is_public' => true]);
$players = CampaignRole::create(['campaign_id' => $campaign->id, 'name' => 'Player']);
foreach (EntityType::default()->get() as $type) {
    CampaignPermission::create([
        'campaign_role_id' => $players->id,
        'access' => true,
        'action' => CampaignPermission::ACTION_READ,
        'entity_type_id' => $type->id,
    ]);
}
CampaignRoleUser::create(['campaign_role_id' => $admin->id, 'user_id' => $dm->id]);
CampaignRoleUser::create(['campaign_role_id' => $players->id, 'user_id' => $player->id]);
(new CampaignSetting(['campaign_id' => $campaign->id, 'dice_rolls' => 0, 'conversations' => 0]))->save();

// The type ("NPC", "Player character") lives on the entity, not the character row.
$c = function (string $name, string $type, array $extra = []) use ($campaign) {
    $entity = Character::factory()->create(['campaign_id' => $campaign->id, 'name' => $name] + $extra)->entity;
    $entity->update(['type' => $type]);

    return $entity;
};
$mara = $c('Mara Quill', 'Player character');
$odo = $c('Odo Fenwick', 'NPC');
$sela = $c('Sela Brightwater', 'NPC');
$hidden = $c('The Grey Envoy', 'NPC', ['is_private' => true]);
$wardens = Organisation::factory()->create(['campaign_id' => $campaign->id, 'name' => 'Reed Wardens'])->entity;
$vale = Location::factory()->create(['campaign_id' => $campaign->id, 'name' => 'Silverfen Vale'])->entity;
$mill = Location::factory()->create(['campaign_id' => $campaign->id, 'name' => 'Fenwick Mill'])->entity;

$r = fn ($owner, $target, string $text, int $attitude = 0, Visibility $visibility = Visibility::All) => Relation::factory()->create([
    'campaign_id' => $campaign->id,
    'owner_id' => $owner->id,
    'target_id' => $target->id,
    'relation' => $text,
    'attitude' => $attitude,
    'visibility_id' => $visibility,
]);
$r($mara, $wardens, 'Scout for', 50);
$r($odo, $mill, 'Runs', 30);
$r($sela, $wardens, 'Captain of', 70);
$r($mara, $odo, 'Owes a favour to', 10);
$r($wardens, $vale, 'Patrols');
$r($sela, $hidden, 'Secretly meets', -40, Visibility::Admin);

$mara->update(['entry' => '<p>Mara scouts the reed paths of Silverfen Vale for the Reed Wardens.</p>'
    . '<h2>Background</h2><p>Raised at Fenwick Mill, she knows every channel by the sound of the water.</p>']);

echo "seeded campaign {$campaign->id} ({$campaign->slug})\n";
