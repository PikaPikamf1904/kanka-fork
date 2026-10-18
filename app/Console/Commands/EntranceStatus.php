<?php

namespace App\Console\Commands;

use App\Services\Entrance\EntranceService;
use Illuminate\Console\Command;

class EntranceStatus extends Command
{
    protected $signature = 'entrance:status';

    protected $description = 'Show the state of the shared entrance (never the password or its hash)';

    public function handle(EntranceService $entrance): int
    {
        $this->line('Enabled: ' . (config('entrance.enabled') ? 'yes' : 'no'));
        $this->line('Password set: ' . ($entrance->isConfigured() ? 'yes' : 'no'));
        $this->line('Updated at: ' . ($entrance->updatedAt()?->toDateTimeString() ?? 'never'));
        $this->line('Managers: ' . count(config('entrance.managers')));

        return self::SUCCESS;
    }
}
