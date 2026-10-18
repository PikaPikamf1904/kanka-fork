<?php

use App\Http\Controllers\EntranceController;
use Illuminate\Support\Facades\Route;

Route::get('/entrance', [EntranceController::class, 'show'])->name('entrance.show');
Route::post('/entrance', [EntranceController::class, 'enter'])
    ->middleware('throttle:entrance')
    ->name('entrance.enter');
Route::post('/entrance/leave', [EntranceController::class, 'leave'])->name('entrance.leave');
