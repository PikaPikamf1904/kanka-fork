<x-forms.field
    field="format"
    :label="__('calendars.fields.format')"
    tooltip
    :helper="__('calendars.helpers.format')">

    <input type="text" name="format" value="{{ old('format', $source->format ?? $model->format ?? null) }}" maxlength="191" class="w-full"  />
</x-forms.field>
