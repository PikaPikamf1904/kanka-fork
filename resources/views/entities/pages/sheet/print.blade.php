<?php /** @var \App\Models\Entity $entity */?>
@extends('layouts.print', [
    'title' => __('entities/sheet.show.title', ['name' => $entity->name]),
    'breadcrumbs' => false,
    'mainTitle' => false,
    'bodyClass' => 'entity-sheet'
])

@section('content')
    <button class="btn2 btn-lg btn-print btn-primary fixed top-5 right-5 print:hidden" onclick="javascript:window.print();">
        <x-icon class="fa-regular fa-print" />
        {{ __('crud.actions.print') }}
    </button>

    <h1 class="text-3xl m-0 mb-4">{{ $entity->name }}</h1>
    @include('entities.pages.sheet._sheet')
@endsection
