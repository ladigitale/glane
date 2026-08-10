<?php

namespace App\Entity;

use ApiPlatform\Metadata\ApiResource;
use ApiPlatform\Metadata\Delete;
use ApiPlatform\Metadata\Get;
use ApiPlatform\Metadata\GetCollection;
use ApiPlatform\Metadata\Patch;
use ApiPlatform\Metadata\Post;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Serializer\Attribute\Groups;
use Symfony\Component\Uid\Uuid;

#[ORM\Entity]
#[ORM\Table(name: 'sessions')]
#[ApiResource(
    operations: [
        new GetCollection(),
        new Get(),
        new Post(),
        new Patch(),
        new Delete(),
    ],
    normalizationContext: ['groups' => ['session:read']],
    denormalizationContext: ['groups' => ['session:write']],
    order: ['startedAt' => 'DESC'],
    paginationEnabled: false,
)]
class Session
{
    #[ORM\Id]
    #[ORM\Column(type: 'uuid', unique: true)]
    #[Groups(['session:read'])]
    private string $id;

    #[ORM\Column]
    #[Groups(['session:read', 'session:write'])]
    private \DateTimeImmutable $startedAt;

    #[ORM\Column(nullable: true)]
    #[Groups(['session:read', 'session:write'])]
    private ?\DateTimeImmutable $endedAt = null;

    #[ORM\Column]
    #[Groups(['session:read', 'session:write'])]
    private int $durationMs = 0;

    #[ORM\Column]
    #[Groups(['session:read', 'session:write'])]
    private int $sampleRate = 48000;

    #[ORM\Column]
    #[Groups(['session:read', 'session:write'])]
    private int $channelCount = 1;

    #[ORM\Column(length: 32)]
    #[Groups(['session:read', 'session:write'])]
    private string $status = 'ready';

    #[ORM\Column(nullable: true)]
    #[Groups(['session:read', 'session:write'])]
    private ?string $title = null;

    /** @var list<array<string, mixed>> */
    #[ORM\Column(type: 'json')]
    #[Groups(['session:read', 'session:write'])]
    private array $gapMarkers = [];

    #[ORM\Column]
    #[Groups(['session:read'])]
    private int $revision = 0;

    #[ORM\Column(nullable: true)]
    #[Groups(['session:read'])]
    private ?\DateTimeImmutable $deletedAt = null;

    #[ORM\ManyToOne(targetEntity: User::class)]
    #[ORM\JoinColumn(nullable: true)]
    private ?User $owner = null;

    public function __construct(?string $id = null)
    {
        $this->id = $id ?? Uuid::v7()->toRfc4122();
        $this->startedAt = new \DateTimeImmutable();
    }

    public function getId(): string
    {
        return $this->id;
    }

    public function getStartedAt(): \DateTimeImmutable
    {
        return $this->startedAt;
    }

    public function setStartedAt(\DateTimeImmutable $startedAt): void
    {
        $this->startedAt = $startedAt;
    }

    public function getEndedAt(): ?\DateTimeImmutable
    {
        return $this->endedAt;
    }

    public function setEndedAt(?\DateTimeImmutable $endedAt): void
    {
        $this->endedAt = $endedAt;
    }

    public function getDurationMs(): int
    {
        return $this->durationMs;
    }

    public function setDurationMs(int $durationMs): void
    {
        $this->durationMs = $durationMs;
    }

    public function getSampleRate(): int
    {
        return $this->sampleRate;
    }

    public function setSampleRate(int $sampleRate): void
    {
        $this->sampleRate = $sampleRate;
    }

    public function getChannelCount(): int
    {
        return $this->channelCount;
    }

    public function setChannelCount(int $channelCount): void
    {
        $this->channelCount = $channelCount;
    }

    public function getStatus(): string
    {
        return $this->status;
    }

    public function setStatus(string $status): void
    {
        $this->status = $status;
    }

    public function getTitle(): ?string
    {
        return $this->title;
    }

    public function setTitle(?string $title): void
    {
        $this->title = $title;
    }

    /** @return list<array<string, mixed>> */
    public function getGapMarkers(): array
    {
        return $this->gapMarkers;
    }

    /** @param list<array<string, mixed>> $gapMarkers */
    public function setGapMarkers(array $gapMarkers): void
    {
        $this->gapMarkers = $gapMarkers;
    }

    public function getRevision(): int
    {
        return $this->revision;
    }

    public function getOwner(): ?User
    {
        return $this->owner;
    }

    public function setOwner(?User $owner): void
    {
        $this->owner = $owner;
    }
}
