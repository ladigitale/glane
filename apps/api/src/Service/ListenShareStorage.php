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
        #[Autowire('%app.listen_ttl_days%')]
        private readonly int $ttlDays,
        #[Autowire('%app.listen_purge_after_days%')]
        private readonly int $purgeAfterDays,
        #[Autowire('%app.listen_max_active%')]
        private readonly int $maxActivePerUser,
        #[Autowire('%app.listen_max_bytes_per_user%')]
        private readonly int $maxBytesPerUser,
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
        $uploadErr = $file->getError();
        if ($uploadErr !== UPLOAD_ERR_OK) {
            throw new \InvalidArgumentException(
                $uploadErr === UPLOAD_ERR_INI_SIZE || $uploadErr === UPLOAD_ERR_FORM_SIZE
                    ? 'file_too_large'
                    : 'upload_failed',
            );
        }
        if ($file->getSize() === false || $file->getSize() > self::MAX_BYTES) {
            throw new \InvalidArgumentException('file_too_large');
        }
        $mime = (string) ($file->getMimeType() ?? '');
        $name = strtolower($file->getClientOriginalName());
        if (!str_contains($mime, 'audio') && !str_ends_with($name, '.mp3')) {
            throw new \InvalidArgumentException('invalid_mime');
        }

        $byteSize = (int) $file->getSize();
        $this->assertQuota($owner, $byteSize);

        $share = new ListenShare();
        $share->setOwner($owner);
        $share->setTitle($title !== '' ? $title : 'Untitled');
        $share->setVisibility($visibility === ListenShare::VIS_PRIVATE ? ListenShare::VIS_PRIVATE : ListenShare::VIS_UNLISTED);
        $share->setLocalProjectId($localProjectId);
        $share->setDurationMs($durationMs);
        $share->setByteSize($byteSize);
        if ($this->ttlDays > 0) {
            $share->setExpiresAt(new \DateTimeImmutable('+'.$this->ttlDays.' days'));
        }

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

    public function revoke(ListenShare $share): void
    {
        $share->revoke();
        $this->deleteFile($share);
        $this->em->flush();
    }

    /** @return array{expired: int, revoked: int, orphans: int} */
    public function purge(): array
    {
        $now = new \DateTimeImmutable();
        $stats = ['expired' => 0, 'revoked' => 0, 'orphans' => 0];

        $expired = $this->em->createQuery(
            'SELECT s FROM App\Entity\ListenShare s WHERE s.expiresAt IS NOT NULL AND s.expiresAt < :now',
        )
            ->setParameter('now', $now)
            ->getResult();
        foreach ($expired as $share) {
            \assert($share instanceof ListenShare);
            $this->removeShare($share);
            ++$stats['expired'];
        }

        if ($this->purgeAfterDays > 0) {
            $cutoff = $now->modify('-'.$this->purgeAfterDays.' days');
            $revoked = $this->em->createQuery(
                'SELECT s FROM App\Entity\ListenShare s WHERE s.revokedAt IS NOT NULL AND s.revokedAt < :cutoff',
            )
                ->setParameter('cutoff', $cutoff)
                ->getResult();
            foreach ($revoked as $share) {
                \assert($share instanceof ListenShare);
                $this->deleteFile($share);
                $this->em->remove($share);
                ++$stats['revoked'];
            }
        }

        $this->em->flush();

        $known = $this->em->createQuery('SELECT s.storagePath FROM App\Entity\ListenShare s')
            ->getSingleColumnResult();
        $knownSet = array_flip($known);
        $dir = $this->resolveDir();
        foreach (glob($dir.'/*.mp3') ?: [] as $path) {
            if (!isset($knownSet[$path]) && is_file($path)) {
                unlink($path);
                ++$stats['orphans'];
            }
        }

        return $stats;
    }

    private function assertQuota(User $owner, int $newBytes): void
    {
        if ($this->maxActivePerUser <= 0 && $this->maxBytesPerUser <= 0) {
            return;
        }

        $now = new \DateTimeImmutable();
        $rows = $this->em->createQuery(
            'SELECT s.byteSize FROM App\Entity\ListenShare s
             WHERE s.owner = :owner
               AND s.revokedAt IS NULL
               AND (s.expiresAt IS NULL OR s.expiresAt > :now)',
        )
            ->setParameter('owner', $owner)
            ->setParameter('now', $now)
            ->getSingleColumnResult();

        $active = \count($rows);
        $bytes = array_sum(array_map(static fn ($b) => (int) $b, $rows));

        if ($this->maxActivePerUser > 0 && $active >= $this->maxActivePerUser) {
            throw new \InvalidArgumentException('quota_active_limit');
        }
        if ($this->maxBytesPerUser > 0 && $bytes + $newBytes > $this->maxBytesPerUser) {
            throw new \InvalidArgumentException('quota_bytes_limit');
        }
    }

    private function removeShare(ListenShare $share): void
    {
        $this->deleteFile($share);
        $this->em->remove($share);
    }

    private function deleteFile(ListenShare $share): void
    {
        $path = $share->getStoragePath();
        if ($path !== '' && is_file($path)) {
            unlink($path);
        }
    }
}
