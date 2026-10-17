<?php /** @var \App\Models\Entity $entity */?>
@extends('layouts.' . (request()->ajax() ? 'ajax' : 'app'), [
    'title' => __('entities/sheet.show.title', ['name' => $entity->name]) . ' - ' . $campaign->name,
    'description' => '',
    'breadcrumbs' => false,
    'mainTitle' => false,
    'bodyClass' => 'entity-sheet'
])

@include('entities.components.og')

@section('entity-header-actions')
    <div class="header-buttons flex flex-wrap gap-2 items-center justify-end">
        @include('entities.pages.sheet._buttons')
        @include('entities.headers.actions', ['edit' => false])
    </div>
@endsection

@section('content')
    @include('entities.pages.subpage', [
        'active' => 'sheet',
        'view' => 'entities.pages.sheet._sheet',
        'entity' => $entity,
    ])
@endsection
