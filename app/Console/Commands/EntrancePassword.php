<?php

namespace App\Console\Commands;

use App\Services\Entrance\EntranceService;
use Illuminate\Console\Command;

class EntrancePassword extends Command
{
    protected $signature = 'entrance:password {--clear : Remove the entrance password}';

    protected $description = 'Set or clear the shared entrance password';

    public function handle(EntranceService $entrance): int
    {
        if ($this->option('clear')) {
            $entrance->clear();
            $this->info('The entrance password was removed. The entrance is now closed to visitors.');

            return self::SUCCESS;
        }

        $min = (int) config('entrance.min_length');
        $password = (string) $this->secret('New entrance password');
        $confirm = (string) $this->secret('Repeat the password');

        if ($password !== $confirm) {
            $this->error('The two entries do not match. Nothing was changed.');

            return self::FAILURE;
        }
        if (mb_strlen($password) < $min) {
            $this->error("The password must be at least {$min} characters. Nothing was changed.");

            return self::FAILURE;
        }

        $entrance->setPassword($password);
        $this->info('Entrance password updated. Everyone who had entered must enter again.');

        return self::SUCCESS;
    }
}
