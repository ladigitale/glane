<?php

declare(strict_types=1);

namespace App\Entity;

use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Uid\Uuid;

#[ORM\Entity]
#[ORM\Table(name: 'listen_shares')]
#[ORM\UniqueConstraint(name: 'uniq_listen_token', columns: ['token'])]
class ListenShare
{
    public const VIS_UNLISTED = 'unlisted';
    public const VIS_PRIVATE = 'private';

    #[ORM\Id]
    #[ORM\Column(type: 'uuid', unique: true)]
    private string $id;

    #[ORM\ManyToOne(targetEntity: User::class)]
    #[ORM\JoinColumn(nullable: false, onDelete: 'CASCADE')]
    private User $owner;

    #[ORM\Column(length: 64)]
    private string $token;

    #[ORM\Column(length: 255)]
    private string $title = '';

    #[ORM\Column(length: 16)]
    private string $visibility = self::VIS_UNLISTED;

    #[ORM\Column(length: 36, nullable: true)]
    private ?string $localProjectId = null;

    #[ORM\Column(nullable: true)]
    private ?int $durationMs = null;

    #[ORM\Column]
    private int $byteSize = 0;

    #[ORM\Column(length: 512)]
    private string $storagePath = '';

    #[ORM\Column]
    private \DateTimeImmutable $createdAt;

    #[ORM\Column]
    private \DateTimeImmutable $updatedAt;

    #[ORM\Column(nullable: true)]
    private ?\DateTimeImmutable $revokedAt = null;

    #[ORM\Column(nullable: true)]
    private ?\DateTimeImmutable $expiresAt = null;

    public function __construct(?string $id = null)
    {
        $this->id = $id ?? Uuid::v7()->toRfc4122();
        $now = new \DateTimeImmutable();
        $this->createdAt = $now;
        $this->updatedAt = $now;
        $this->token = rtrim(strtr(base64_encode(random_bytes(24)), '+/', '-_'), '=');
    }

    public function getId(): string
    {
        return $this->id;
    }

    public function getOwner(): User
    {
        return $this->owner;
    }

    public function setOwner(User $owner): void
    {
        $this->owner = $owner;
    }

    public function getToken(): string
    {
        return $this->token;
    }

    public function getTitle(): string
    {
        return $this->title;
    }

    public function setTitle(string $title): void
    {
        $this->title = $title;
        $this->touch();
    }

    public function getVisibility(): string
    {
        return $this->visibility;
    }

    public function setVisibility(string $visibility): void
    {
        if (!\in_array($visibility, [self::VIS_UNLISTED, self::VIS_PRIVATE], true)) {
            throw new \InvalidArgumentException('invalid_visibility');
        }
        $this->visibility = $visibility;
        $this->touch();
    }

    public function getLocalProjectId(): ?string
    {
        return $this->localProjectId;
    }

    public function setLocalProjectId(?string $localProjectId): void
    {
        $this->localProjectId = $localProjectId;
    }

    public function getDurationMs(): ?int
    {
        return $this->durationMs;
    }

    public function setDurationMs(?int $durationMs): void
    {
        $this->durationMs = $durationMs;
    }

    public function getByteSize(): int
    {
        return $this->byteSize;
    }

    public function setByteSize(int $byteSize): void
    {
        $this->byteSize = $byteSize;
    }

    public function getStoragePath(): string
    {
        return $this->storagePath;
    }

    public function setStoragePath(string $storagePath): void
    {
        $this->storagePath = $storagePath;
    }

    public function getCreatedAt(): \DateTimeImmutable
    {
        return $this->createdAt;
    }

    public function getUpdatedAt(): \DateTimeImmutable
    {
        return $this->updatedAt;
    }

    public function getRevokedAt(): ?\DateTimeImmutable
    {
        return $this->revokedAt;
    }

    public function getExpiresAt(): ?\DateTimeImmutable
    {
        return $this->expiresAt;
    }

    public function setExpiresAt(?\DateTimeImmutable $expiresAt): void
    {
        $this->expiresAt = $expiresAt;
    }

    public function isExpired(): bool
    {
        return $this->expiresAt !== null && $this->expiresAt <= new \DateTimeImmutable();
    }

    public function isActive(): bool
    {
        return $this->revokedAt === null && !$this->isExpired();
    }

    public function revoke(): void
    {
        $this->revokedAt = new \DateTimeImmutable();
        $this->visibility = self::VIS_PRIVATE;
        $this->touch();
    }

    public function isPubliclyReadable(): bool
    {
        return $this->isActive() && $this->visibility === self::VIS_UNLISTED;
    }

    private function touch(): void
    {
        $this->updatedAt = new \DateTimeImmutable();
    }
}
