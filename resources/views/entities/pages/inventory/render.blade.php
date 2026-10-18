<?php /** @var \App\Models\Entity $entity */?>
<x-tutorial code="inventory">
    <p>{!! __('entities/inventories.tutorials.all', ['name' => $entity->name]) !!}</p>
</x-tutorial>
@include('entities.pages.inventory.grid')
