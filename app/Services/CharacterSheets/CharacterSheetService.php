<?php

namespace App\Services\CharacterSheets;

use App\Enums\AttributeType;
use App\Models\Attribute;
use App\Models\Scopes\PrivateScope;
use App\Traits\CampaignAware;
use App\Traits\EntityAware;
use App\Traits\UserAware;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Stevebauman\Purify\Facades\Purify;

/**
 * Reads and saves a character's D&D 2024 sheet. Each field is an ordinary property of the
 * character, found by its name without the "[range:...]" part, so properties a campaign
 * already uses (like "Strength") are picked up instead of duplicated.
 *
 * Properties the user may not see are left alone: they are not shown, not overwritten and not
 * used to fill in the sheet. Kanka's PrivateScope does the same on the Properties page, but
 * only outside the console and for the logged-in user, so the rule is applied here directly.
 */
class CharacterSheetService
{
    use CampaignAware;
    use EntityAware;
    use UserAware;

    public const int TEXT_LENGTH = 191;

    public const int BLOCK_LENGTH = 16000;

    public function __construct(protected Dnd2024Sheet $sheet) {}

    public function sheet(): Dnd2024Sheet
    {
        return $this->sheet;
    }

    /**
     * The property behind each field, or null when the character doesn't have one the user
     * may see. Public properties win over private ones with the same name, so the DM and the
     * players see the same values.
     *
     * @return array<string, ?Attribute> field key => property
     */
    public function attributes(): array
    {
        $byName = [];
        foreach ($this->candidates() as $attribute) {
            if ($attribute->type_id === AttributeType::Section) {
                continue;
            }
            $byName[$this->baseName($attribute->name)] ??= $attribute;
        }

        $attributes = [];
        foreach ($this->sheet->fields() as $key => $field) {
            $attributes[$key] = $byName[mb_strtolower($field['base'])] ?? null;
        }

        return $attributes;
    }

    /**
     * The value of each field, cleaned up for the sheet: integers within range, booleans for
     * checkboxes, one of the options (or null) for lists, and text.
     *
     * @param  array<string, ?Attribute>  $attributes
     * @return array<string, mixed>
     */
    public function values(array $attributes): array
    {
        $values = [];
        foreach ($this->sheet->fields() as $key => $field) {
            $values[$key] = $this->normalise($field, $attributes[$key]?->value);
        }

        return $values;
    }

    /**
     * Validation rules for the edit form, which sends the fields as fields[key].
     *
     * @return array<string, array<int, mixed>>
     */
    public function rules(): array
    {
        $rules = ['fields' => ['nullable', 'array']];
        foreach ($this->sheet->fields() as $key => $field) {
            $rules['fields.' . $key] = match (true) {
                $field['type'] === AttributeType::Checkbox => ['nullable', 'boolean'],
                $field['type'] === AttributeType::Number => ['nullable', 'integer', 'between:' . $field['min'] . ',' . $field['max']],
                isset($field['options']) => ['nullable', 'string', Rule::in($field['options'])],
                $field['type'] === AttributeType::Block => ['nullable', 'string', 'max:' . self::BLOCK_LENGTH],
                default => ['nullable', 'string', 'max:' . self::TEXT_LENGTH],
            };
        }

        return $rules;
    }

    /**
     * Field names for validation messages.
     *
     * @return array<string, string>
     */
    public function attributeNames(): array
    {
        $names = [];
        foreach ($this->sheet->fields() as $key => $field) {
            $names['fields.' . $key] = $field['base'];
        }

        return $names;
    }

    /**
     * Save the submitted fields. Fields missing from $input are left as they are, and empty
     * fields don't create new properties.
     *
     * @param  array<string, mixed>  $input  field key => submitted value
     */
    public function save(array $input): bool
    {
        $attributes = $this->attributes();
        $created = [];
        $changed = false;

        foreach ($this->sheet->fields() as $key => $field) {
            if (! array_key_exists($key, $input)) {
                continue;
            }
            $value = $this->storable($field, $input[$key]);
            $attribute = $attributes[$key];
            if ($attribute === null) {
                if ($value === null) {
                    continue;
                }
                $attribute = new Attribute([
                    'entity_id' => $this->entity->id,
                    'name' => $field['name'],
                    'type_id' => $field['type'],
                    'is_private' => false,
                ]);
                $created[] = $attribute;
            }

            // Kanka clamps a ranged number in setValue(), but turns null into the minimum.
            if ($value === null) {
                $attribute->value = null;
            } else {
                $attribute->setValue($value);
            }
            if ($attribute->exists && $attribute->isDirty()) {
                $attribute->save();
                $changed = true;
            }
        }

        if (! empty($created)) {
            $this->create($created);
            $changed = true;
        }
        if ($changed) {
            $this->entity->touch();
        }

        return $changed;
    }

    /**
     * Add new properties at the end, under the sheet's section.
     *
     * @param  array<int, Attribute>  $attributes
     */
    protected function create(array $attributes): void
    {
        // Only properties the user may see count, so the new properties' order doesn't give away
        // how many hidden ones there are.
        $candidates = $this->candidates();
        $order = (int) $candidates->max('default_order');

        $hasSection = $candidates->contains(fn (Attribute $attribute) => $attribute->type_id === AttributeType::Section
            && $this->baseName($attribute->name) === mb_strtolower(Dnd2024Sheet::SECTION));
        if (! $hasSection) {
            array_unshift($attributes, new Attribute([
                'entity_id' => $this->entity->id,
                'name' => Dnd2024Sheet::SECTION,
                'type_id' => AttributeType::Section,
                'is_private' => false,
            ]));
        }

        foreach ($attributes as $attribute) {
            $attribute->default_order = ++$order;
            $attribute->save();
        }
    }

    /**
     * The character's properties that the user may see, public ones first.
     *
     * @return Collection<int, Attribute>
     */
    protected function candidates(): Collection
    {
        return $this->entity->attributes()
            ->withoutGlobalScope(PrivateScope::class)
            ->where('is_hidden', false)
            ->when(! $this->canSeePrivate(), fn ($query) => $query->where('is_private', false))
            ->orderBy('is_private')
            ->orderBy('default_order')
            ->orderBy('id')
            ->get();
    }

    protected function canSeePrivate(): bool
    {
        return $this->user !== null && $this->user->can('admin', $this->campaign);
    }

    /**
     * "Strength[range:1,30]" and " strength " are both "strength".
     */
    protected function baseName(string $name): string
    {
        return mb_strtolower(trim(Str::before(strip_tags($name), '[range:')));
    }

    /**
     * What the sheet makes of a stored value.
     */
    protected function normalise(array $field, mixed $value): mixed
    {
        if ($field['type'] === AttributeType::Checkbox) {
            return filter_var($value, FILTER_VALIDATE_BOOLEAN);
        }
        if ($value === null || trim((string) $value) === '') {
            return null;
        }
        if ($field['type'] === AttributeType::Number) {
            if (! is_numeric($value)) {
                return null;
            }

            return max($field['min'], min($field['max'], (int) round((float) $value)));
        }
        if (isset($field['options'])) {
            foreach ($field['options'] as $index => $option) {
                if (mb_strtolower(trim((string) $value)) === mb_strtolower($option)) {
                    return $index === 0 ? null : $option;
                }
            }

            return null;
        }

        return (string) $value;
    }

    /**
     * What gets stored for a submitted value, or null to empty the property.
     */
    protected function storable(array $field, mixed $value): ?string
    {
        if ($field['type'] === AttributeType::Checkbox) {
            return filter_var($value, FILTER_VALIDATE_BOOLEAN) ? '1' : null;
        }
        if (is_array($value)) {
            return null;
        }
        if ($field['type'] === AttributeType::Number || isset($field['options'])) {
            $value = $this->normalise($field, $value);

            return $value === null ? null : (string) $value;
        }

        $limit = $field['type'] === AttributeType::Block ? self::BLOCK_LENGTH : self::TEXT_LENGTH;
        $value = trim(Purify::clean(mb_substr((string) $value, 0, $limit)));

        return $value === '' ? null : $value;
    }
}
