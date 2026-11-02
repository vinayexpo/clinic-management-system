<?php

namespace App\Events;

use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;

class ApplicationInvalidated implements ShouldBroadcastNow
{
    /** @param list<int> $userIds */
    public function __construct(private array $userIds) {}

    /** @return list<PrivateChannel> */
    public function broadcastOn(): array
    {
        return array_map(fn (int $id) => new PrivateChannel('users.'.$id), $this->userIds);
    }

    public function broadcastAs(): string
    {
        return 'application.invalidated';
    }

    /** @return array{scope: string} */
    public function broadcastWith(): array
    {
        return ['scope' => 'application'];
    }
}
