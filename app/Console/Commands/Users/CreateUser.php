<?php

namespace App\Console\Commands\Users;

use App\Models\User;
use App\Rules\AccountEmail;
use App\Rules\AccountName;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Validator;

class CreateUser extends Command
{
    /**
     * The name and signature of the console command.
     *
     * @var string
     */
    protected $signature = 'users:create {email} {name}';

    /**
     * The console command description.
     *
     * @var string
     */
    protected $description = 'Create a user account, for self-hosted wikis with sign-up turned off. Asks for the password.';

    /**
     * Execute the console command.
     */
    public function handle(): int
    {
        $data = [
            'email' => trim((string) $this->argument('email')),
            'name' => trim((string) $this->argument('name')),
        ];
        // Same rules as the sign-up form, minus the DNS lookup so it works offline
        $validator = Validator::make($data, [
            'name' => ['required', 'string', 'max:255', 'min:2', new AccountName],
            'email' => ['required', 'string', 'email:rfc', 'max:255', 'unique:users', new AccountEmail],
        ]);
        if ($validator->fails()) {
            foreach ($validator->errors()->all() as $error) {
                $this->error($error);
            }

            return self::FAILURE;
        }

        if (! $this->input->isInteractive()) {
            $this->error('Run this in a terminal: it asks for the password, which is never passed on the command line.');

            return self::FAILURE;
        }
        $password = (string) $this->secret('Password (at least 8 characters)');
        if (mb_strlen($password) < 8) {
            $this->error('The password must be at least 8 characters.');

            return self::FAILURE;
        }
        if (! hash_equals($password, (string) $this->secret('Password again'))) {
            $this->error('The passwords do not match.');

            return self::FAILURE;
        }

        $user = User::create([
            'name' => $data['name'],
            'email' => $data['email'],
            'password' => Hash::make($password),
        ]);
        unset($password);

        $this->info("Created user #{$user->id} ({$user->email}). They can log in now.");

        return self::SUCCESS;
    }
}
