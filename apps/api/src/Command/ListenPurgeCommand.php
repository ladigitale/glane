<?php

declare(strict_types=1);

namespace App\Command;

use App\Service\ListenShareStorage;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Output\OutputInterface;
use Symfony\Component\Console\Style\SymfonyStyle;

#[AsCommand(
    name: 'app:listen:purge',
    description: 'Remove expired listen shares, old revoked rows, and orphan MP3 files',
)]
final class ListenPurgeCommand extends Command
{
    public function __construct(
        private readonly ListenShareStorage $storage,
    ) {
        parent::__construct();
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $io = new SymfonyStyle($input, $output);
        $stats = $this->storage->purge();

        $io->success(\sprintf(
            'Purged %d expired, %d revoked (stale rows), %d orphan file(s).',
            $stats['expired'],
            $stats['revoked'],
            $stats['orphans'],
        ));

        return Command::SUCCESS;
    }
}
