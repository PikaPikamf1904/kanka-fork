<?php

namespace App\Jobs;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Storage;

class FileCleanup implements ShouldQueue
{
    use Dispatchable;
    use InteractsWithQueue;
    use Queueable;
    use SerializesModels;

    protected string $path;

    protected ?string $disk;

    /**
     * Create a new job instance. Without a disk, the default disk is used.
     */
    public function __construct(string $path, ?string $disk = null)
    {
        $this->path = $path;
        $this->disk = $disk;
    }

    /**
     * Execute the job.
     */
    public function handle(): void
    {
        $disk = Storage::disk($this->disk);
        if ($disk->exists($this->path)) {
            $disk->delete($this->path);
        }
    }
}
