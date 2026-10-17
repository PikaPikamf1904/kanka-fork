@if (auth()->check() && auth()->user()->can('update', $entity) && auth()->user()->can('attributes', [$entity, $campaign]))
    <a href="{{ route('entities.sheet.edit', [$campaign, $entity]) }}" class="btn2 btn-sm">
        <x-icon class="fa-regular fa-pen-to-square" />
        {{ __('entities/sheet.actions.edit') }}
    </a>
@endif
<a href="{{ route('entities.sheet.print', [$campaign, $entity]) }}" class="btn2 btn-sm" target="_blank">
    <x-icon class="fa-regular fa-print" />
    {{ __('entities/sheet.actions.print') }}
</a>
