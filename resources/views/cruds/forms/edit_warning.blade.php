<?php
if ($model instanceof \App\Models\Post) {
    $modelName = 'Post';
    $modelId = $model->id;
} elseif ($model instanceof \App\Models\Campaign) {
    $modelName = null;
    $modelId = $model->id;
} elseif ($model instanceof \App\Models\TimelineElement) {
    $modelName = 'TimelineElement';
    $modelId = $model->id;
} elseif ($model instanceof \App\Models\QuestElement) {
    $modelName = 'QuestElement';
    $modelId = $model->id;
} else {
    // Chronicle: a module model (Character, Location, …) is warned about through its entity.
    $modelName = 'Entity';
    $modelId = $model instanceof \App\Models\Entity ? $model->id : ($model->entity->id ?? $model->id);
}
?>
<x-dialog id="edit-warning" :loading="true" :dismissible="false"></x-dialog>
<input type="hidden" name="edit-warning" data-url="{{ route('campaign.editing-warning', [$campaign, 'model' => $modelName, 'id' => $modelId]) }}" />
