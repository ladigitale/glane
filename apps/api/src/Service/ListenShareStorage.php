<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\ListenShare;
use App\Entity\User;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\HttpFoundation\File\UploadedFile;

final class ListenShareStorage
{
    private const MAX_BYTES = 50 * 1024 * 1024;

    public function __construct(
        private readonly EntityManagerInterface $em,
        #[Autowire('%app.listen_dir%')]
        private readonly string $listenDir,
    ) {
    }

    public function resolveDir(): string
    {
        $dir = $this->listenDir;
        if (!is_dir($dir) && !mkdir($dir, 0775, true) && !is_dir($dir)) {
            throw new \RuntimeException('Cannot create listen directory');
        }

        return $dir;
    }

    public function createFromUpload(
        User $owner,
        UploadedFile $file,
        string $title,
        string $visibility,
        ?string $localProjectId,
        ?int $durationMs,
    ): ListenShare {
        if ($file->getSize() === false || $file->getSize() > self::MAX_BYTES) {
            throw new \InvalidArgumentException('file_too_large');
        }
        $mime = (string) ($file->getMimeType() ?? '');
        $name = strtolower($file->getClientOriginalName());
        if (!str_contains($mime, 'audio') && !str_ends_with($name, '.mp3')) {
            throw new \InvalidArgumentException('invalid_mime');
        }

        $share = new ListenShare();
        $share->setOwner($owner);
        $share->setTitle($title !== '' ? $title : 'Untitled');
        $share->setVisibility($visibility === ListenShare::VIS_PRIVATE ? ListenShare::VIS_PRIVATE : ListenShare::VIS_UNLISTED);
        $share->setLocalProjectId($localProjectId);
        $share->setDurationMs($durationMs);
        $share->setByteSize((int) $file->getSize());

        $dir = $this->resolveDir();
        $filename = $share->getId().'.mp3';
        $file->move($dir, $filename);
        $share->setStoragePath($dir.'/'.$filename);

        $this->em->persist($share);
        $this->em->flush();

        return $share;
    }

    public function findByToken(string $token): ?ListenShare
    {
        return $this->em->getRepository(ListenShare::class)->findOneBy(['token' => $token]);
    }
}
