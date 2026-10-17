<?php

/*
 * The connections web (the whole campaign) and the relations map (one entity) are JSON
 * endpoints that the graph pages draw. A player must not get a hidden entity, a DM-only
 * relation, a private membership or a mention inside a DM-only post from either, by name, by
 * id or by an edge between two visible entities. Each test also checks that the DM does see
 * that content, so a broken fixture cannot make a test pass.
 */

use App\Enums\Visibility;
use App\Models\Character;
use App\Models\CharacterFamily;
use App\Models\EntityLocation;
use App\Models\Family;
use App\Models\Location;
use App\Models\Organisation;
use App\Models\OrganisationMember;
use App\Models\Post;
use App\Models\Relation;
use Illuminate\Database\Eloquent\ModelNotFoundException;

require_once __DIR__ . '/support.php';

/**
 * dmOnlyFixture() plus organisations, families, a location, a mirrored relation and mentions,
 * each with a DM-only part. Names starting with "dmonly-" are secret; edges between visible
 * entities that only the DM may see are returned so tests can look for them by id.
 *
 * @return array<string, mixed>
 */
function graphFixture(): array
{
    $fixture = dmOnlyFixture();
    ['public' => $public, 'hidden' => $hidden, 'ally' => $ally] = $fixture;

    // A visible relation whose mirror is DM-only: the player sees one side and must not
    // learn that the other side exists.
    $shift = Relation::factory()->create([
        'campaign_id' => 1,
        'owner_id' => $public->id,
        'target_id' => $ally->id,
        'relation' => 'Shares the night shift',
        'visibility_id' => Visibility::All,
    ]);
    $mirror = Relation::factory()->create([
        'campaign_id' => 1,
        'owner_id' => $ally->id,
        'target_id' => $public->id,
        'relation' => 'dmonly-mirror-relation',
        'visibility_id' => Visibility::Admin,
        'mirror_id' => $shift->id,
    ]);
    $shift->update(['mirror_id' => $mirror->id]);

    // A visible relation from a hidden entity: its text is harmless, its owner is not.
    Relation::factory()->create([
        'campaign_id' => 1,
        'owner_id' => $hidden->id,
        'target_id' => $ally->id,
        'relation' => 'Pays the keeper',
        'visibility_id' => Visibility::All,
    ]);

    $guild = Organisation::factory()->create(['campaign_id' => 1, 'name' => 'Harbor Guild'])->entity;
    $hiddenGuild = Organisation::factory()->create(['campaign_id' => 1, 'name' => 'dmonly-hidden-guild'])->entity;
    $hiddenGuild->update(['is_private' => true]);
    OrganisationMember::create(['organisation_id' => $guild->entity_id, 'character_id' => $public->entity_id, 'role' => 'Quartermaster']);
    OrganisationMember::create(['organisation_id' => $guild->entity_id, 'character_id' => $ally->entity_id, 'role' => 'dmonly-member-role', 'is_private' => true]);
    OrganisationMember::create(['organisation_id' => $guild->entity_id, 'character_id' => $hidden->entity_id, 'role' => 'Lookout']);
    OrganisationMember::create(['organisation_id' => $hiddenGuild->entity_id, 'character_id' => $public->entity_id, 'role' => 'Informant']);

    $clan = Family::factory()->create(['campaign_id' => 1, 'name' => 'Tidewater Clan'])->entity;
    CharacterFamily::create(['family_id' => $clan->entity_id, 'character_id' => $public->entity_id]);
    CharacterFamily::create(['family_id' => $clan->entity_id, 'character_id' => $ally->entity_id, 'is_private' => true]);
    CharacterFamily::create(['family_id' => $clan->entity_id, 'character_id' => $hidden->entity_id]);

    $ward = Location::factory()->create(['campaign_id' => 1, 'name' => 'Harbor Ward'])->entity;
    $cove = Location::factory()->create(['campaign_id' => 1, 'name' => 'dmonly-hidden-cove'])->entity;
    $cove->update(['is_private' => true]);
    EntityLocation::create(['entity_id' => $public->id, 'location_id' => $ward->entity_id]);
    EntityLocation::create(['entity_id' => $hidden->id, 'location_id' => $ward->entity_id]);
    EntityLocation::create(['entity_id' => $public->id, 'location_id' => $cove->entity_id]);

    // Mentions of Harbor Watch: one in a DM-only post on a visible character, one in a hidden
    // character's entry. Neither may show up as a "mentioned by" edge for a player.
    $bell = Character::factory()->create(['campaign_id' => 1, 'name' => 'Fog Bell Ringer'])->entity;
    Post::factory()->create([
        'entity_id' => $bell->id,
        'name' => 'Sealed log',
        'entry' => '<p>Watching [character:' . $public->id . '] closely.</p>',
        'visibility_id' => Visibility::Admin,
    ]);
    $hidden->update(['entry' => '<p>Plans against [character:' . $public->id . '].</p>']);

    return $fixture + compact('shift', 'mirror', 'guild', 'hiddenGuild', 'clan', 'ward', 'cove', 'bell');
}

/**
 * Every entity id a graph response mentions: its nodes and both ends of every edge.
 *
 * @return array<int, int>
 */
function graphEntityIds(array $json, string $edges): array
{
    $ids = array_map('intval', array_keys($json['entities']));
    foreach ($json[$edges] as $edge) {
        $ids[] = (int) $edge['source'];
        $ids[] = (int) $edge['target'];
    }

    return array_values(array_unique($ids));
}

function graphHasEdge(array $json, string $edges, int $source, int $target, ?string $type = null): bool
{
    foreach ($json[$edges] as $edge) {
        if ((int) $edge['source'] === $source && (int) $edge['target'] === $target && ($type === null || $edge['type'] === $type)) {
            return true;
        }
    }

    return false;
}

it('keeps DM-only relations and hidden entities out of the connections web', function () {
    $this->asUser()->withCampaign()->withCampaigns();
    $f = graphFixture();
    // Another campaign's relation must never appear, even for someone who runs both.
    $elsewhere = Character::factory()->create(['campaign_id' => 2, 'name' => 'dmonly-other-campaign-a'])->entity;
    $other = Character::factory()->create(['campaign_id' => 2, 'name' => 'dmonly-other-campaign-b'])->entity;
    Relation::factory()->create([
        'campaign_id' => 2,
        'owner_id' => $elsewhere->id,
        'target_id' => $other->id,
        'relation' => 'dmonly-other-campaign-relation',
        'visibility_id' => Visibility::All,
    ]);

    dmOnlyPlayer();
    $this->asWebRequest();
    $this->get(route('connections.web', [1]))->assertOk();
    $response = $this->getJson(route('connections.web.api', [1]))->assertOk();
    expectNoDmOnlyText($response, 'connections web');
    $json = $response->json();
    expect(graphEntityIds($json, 'nodes'))
        ->toContain($f['public']->id, $f['ally']->id)
        ->not->toContain($f['hidden']->id);
    $shift = collect($json['nodes'])->firstWhere('id', $f['shift']->id);
    expect($shift)->not->toBeNull()
        ->and($shift['text'])->toBe('Shares the night shift')
        // Its mirror is DM-only, so to the player this is a one-way relation.
        ->and($shift['is_mirrored'])->toBeFalse()
        // A read-only player gets no edit links.
        ->and($shift)->not->toHaveKey('url');
    expect(collect($json['nodes'])->pluck('id')->all())->not->toContain($f['mirror']->id);
    // The page builds its search and type filter from these entities alone, so they carry
    // their type, and the hidden entity cannot show up there either.
    expect($json['entities'][$f['public']->id])
        ->toMatchArray(['type_id' => $f['public']->type_id, 'type' => $f['public']->entityType->name()]);
    expect(collect($json['entities'])->every(fn ($e) => isset($e['type_id'], $e['type'])))->toBeTrue();

    dmOnlyAdmin();
    $this->asWebRequest();
    $json = $this->getJson(route('connections.web.api', [1]))->assertOk()->json();
    $content = json_encode($json);
    expect($content)->toContain('dmonly-secret-relation')
        ->toContain('dmonly-relation-to-hidden')
        ->toContain('dmonly-hidden-villain')
        ->not->toContain('dmonly-other-campaign');
    expect(collect($json['nodes'])->firstWhere('id', $f['shift']->id)['is_mirrored'])->toBeTrue();
});

it('shows nothing from the connections web of a campaign the user is not in', function () {
    $this->asUser()->withCampaign()->withCampaigns();
    $a = Character::factory()->create(['campaign_id' => 2, 'name' => 'dmonly-other-campaign-a'])->entity;
    $b = Character::factory()->create(['campaign_id' => 2, 'name' => 'dmonly-other-campaign-b'])->entity;
    Relation::factory()->create([
        'campaign_id' => 2,
        'owner_id' => $a->id,
        'target_id' => $b->id,
        'relation' => 'dmonly-other-campaign-relation',
        'visibility_id' => Visibility::All,
    ]);

    // The campaign's route binding refuses a non-member. Kanka then answers with its "this
    // campaign is private" page in place of the graph.
    dmOnlyPlayer();
    $this->asWebRequest();
    $response = $this->getJson(route('connections.web.api', [2]));
    expect($response->exception)->toBeInstanceOf(ModelNotFoundException::class)
        ->and($response->getContent())->not->toContain('"nodes"')
        ->not->toContain('dmonly-other-campaign');
    expectNoDmOnlyText($response);
});

it('starts each graph empty, so the DM\'s graph never reaches the next user', function () {
    $this->asUser()->withCampaign();
    $f = graphFixture();

    // One process serves the DM, then a player, as a long-running PHP server would. The
    // controllers and their graph services are reused between the two requests.
    dmOnlyAdmin();
    $this->asWebRequest();
    expect($this->getJson(route('connections.web.api', [1]))->assertOk()->getContent())
        ->toContain('dmonly-secret-relation');
    expect($this->getJson(route('entities.relations_map', [1, $f['public']]))->assertOk()->getContent())
        ->toContain('dmonly-secret-relation');

    dmOnlyPlayer();
    $this->asWebRequest();
    $web = $this->getJson(route('connections.web.api', [1]))->assertOk();
    expectNoDmOnlyText($web, 'connections web after the DM');
    expect(collect($web->json('nodes'))->pluck('id')->duplicates())->toBeEmpty();
    $map = $this->getJson(route('entities.relations_map', [1, $f['public']]))->assertOk();
    expectNoDmOnlyText($map, 'relations map after the DM');
    expect(graphEntityIds($map->json(), 'relations'))->not->toContain($f['hidden']->id);
});

it('keeps DM-only content out of the relations map', function (string $entity, ?string $option) {
    $this->asUser()->withCampaign();
    $f = graphFixture();
    $url = route('entities.relations_map', [1, $f[$entity]] + ($option ? ['option' => $option] : []));

    dmOnlyPlayer();
    $this->asWebRequest();
    $response = $this->getJson($url)->assertOk();
    expectNoDmOnlyText($response, $entity . ' map');
    $json = $response->json();
    $ids = graphEntityIds($json, 'relations');
    expect($ids)->toContain($f[$entity]->id)
        ->not->toContain($f['hidden']->id)
        ->not->toContain($f['hiddenGuild']->id)
        ->not->toContain($f['cove']->id);
    // Private memberships: the ally is visible, the membership is not.
    expect(graphHasEdge($json, 'relations', $f['guild']->id, $f['ally']->id))->toBeFalse()
        ->and(graphHasEdge($json, 'relations', $f['clan']->id, $f['ally']->id))->toBeFalse()
        // A mention inside a DM-only post.
        ->and(graphHasEdge($json, 'relations', $f['public']->id, $f['bell']->id, 'entity-mention'))->toBeFalse();
    foreach ($json['relations'] as $edge) {
        // A read-only player gets no edit links, and a mirror they can't see isn't hinted at.
        expect($edge)->not->toHaveKey('edit_url');
        if (($edge['text'] ?? null) === 'Shares the night shift') {
            expect($edge['is_mirrored'])->toBeFalse();
        }
    }
})->with([
    'character' => ['public', null],
    'character, related' => ['public', 'related'],
    'character, mentions' => ['public', 'mentions'],
    'character, relations only' => ['public', 'only_relations'],
    'ally, mentions' => ['ally', 'mentions'],
    'organisation, related' => ['guild', 'related'],
    'family, related' => ['clan', 'related'],
    'location, related' => ['ward', 'related'],
    'location, mentions' => ['ward', 'mentions'],
]);

it('shows the DM everything on the relations map', function () {
    $this->asUser()->withCampaign();
    $f = graphFixture();

    dmOnlyAdmin();
    $this->asWebRequest();
    $json = $this->getJson(route('entities.relations_map', [1, $f['public'], 'option' => 'mentions']))->assertOk()->json();
    expect(json_encode($json))->toContain('dmonly-secret-relation')
        ->toContain('dmonly-relation-to-hidden')
        ->toContain('dmonly-hidden-villain')
        ->toContain('dmonly-hidden-guild')
        ->toContain('dmonly-hidden-cove')
        // A character's map labels its organisations' members with their roles.
        ->toContain('dmonly-member-role');
    expect(graphHasEdge($json, 'relations', $f['public']->id, $f['bell']->id, 'entity-mention'))->toBeTrue();
    $shift = collect($json['relations'])->firstWhere('text', 'Shares the night shift');
    expect($shift['is_mirrored'])->toBeTrue()
        ->and($shift)->toHaveKey('edit_url');

    $json = $this->getJson(route('entities.relations_map', [1, $f['guild'], 'option' => 'related']))->assertOk()->json();
    expect(graphHasEdge($json, 'relations', $f['guild']->id, $f['ally']->id))->toBeTrue();

    $json = $this->getJson(route('entities.relations_map', [1, $f['clan'], 'option' => 'related']))->assertOk()->json();
    expect(graphHasEdge($json, 'relations', $f['clan']->id, $f['ally']->id))->toBeTrue();
});

it('refuses a hidden entity\'s relations map to a player', function (?string $option) {
    $this->asUser()->withCampaign();
    $f = graphFixture();

    dmOnlyPlayer();
    $this->asWebRequest();
    foreach (['hidden', 'hiddenGuild', 'cove'] as $key) {
        $response = $this->getJson(route('entities.relations_map', [1, $f[$key]] + ($option ? ['option' => $option] : [])));
        expect($response->status())->toBeIn([403, 404]);
        expectNoDmOnlyText($response, $key . ' map');
    }
})->with([null, 'related', 'mentions']);
