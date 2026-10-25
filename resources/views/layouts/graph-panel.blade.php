<?php
/**
 * The floating relations graph: the relations web page, embedded. That page and its API apply
 * the viewer's permissions, so the panel shows exactly what the full page would.
 * @var \App\Models\Campaign $campaign
 */
$graphFocus = isset($entity) && $entity instanceof \App\Models\Entity ? $entity->id : null;
?>
<section
    id="graph-panel"
    class="graph-panel"
    role="dialog"
    aria-labelledby="graph-panel-title"
    data-src="{{ route('connections.web', [$campaign, 'embed' => 1]) }}"
    data-focus="{{ $graphFocus }}"
    data-campaign="{{ $campaign->id }}"
    data-label-maximize="{{ __('connections/web.panel.maximize') }}"
    data-label-restore="{{ __('connections/web.panel.restore') }}"
    hidden
>
    <div class="graph-panel-bar" data-graph-drag>
        <span id="graph-panel-title" class="graph-panel-title">
            <x-icon class="fa-regular fa-circle-nodes" /> {{ __('connections/web.panel.toggle') }}
        </span>
        <button type="button" data-graph-action="refresh" title="{{ __('connections/web.panel.refresh') }}" aria-label="{{ __('connections/web.panel.refresh') }}">
            <x-icon class="fa-regular fa-arrows-rotate" />
        </button>
        <a href="{{ route('connections.web', $campaign) }}" title="{{ __('connections/web.panel.full-page') }}" aria-label="{{ __('connections/web.panel.full-page') }}">
            <x-icon class="fa-regular fa-up-right-from-square" />
        </a>
        <button type="button" data-graph-action="minimize" title="{{ __('connections/web.panel.minimize') }}" aria-label="{{ __('connections/web.panel.minimize') }}">
            <x-icon class="fa-regular fa-window-minimize" />
        </button>
        <button type="button" data-graph-action="maximize" title="{{ __('connections/web.panel.maximize') }}" aria-label="{{ __('connections/web.panel.maximize') }}">
            <x-icon class="fa-regular fa-window-maximize" />
        </button>
        <button type="button" data-graph-action="close" title="{{ __('connections/web.panel.close') }}" aria-label="{{ __('connections/web.panel.close') }}">
            <x-icon class="fa-regular fa-xmark" />
        </button>
    </div>
    <div class="graph-panel-body"></div>
    <div class="graph-panel-resize" data-graph-resize aria-hidden="true"></div>
</section>
