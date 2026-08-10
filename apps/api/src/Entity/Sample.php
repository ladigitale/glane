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
#[ORM\Table(name: 'samples')]
#[ApiResource(
    operations: [
        new GetCollection(),
        new Get(),
        new Post(),
        new Patch(),
        new Delete(),
    ],
    normalizationContext: ['groups' => ['sample:read']],
    denormalizationContext: ['groups' => ['sample:write']],
    paginationEnabled: false,
)]
class Sample
{
    #[ORM\Id]
    #[ORM\Column(type: 'uuid', unique: true)]
    #[Groups(['sample:read'])]
    private string $id;

    #[ORM\Column(type: 'uuid')]
    #[Groups(['sample:read', 'sample:write'])]
    private string $sessionId;

    #[ORM\Column]
    #[Groups(['sample:read', 'sample:write'])]
    private int $sourceOffsetMs = 0;

    #[ORM\Column]
    #[Groups(['sample:read', 'sample:write'])]
    private int $durationMs = 0;

    #[ORM\Column(length: 32)]
    #[Groups(['sample:read', 'sample:write'])]
    private string $class = 'unclassified';

    #[ORM\Column(type: 'float')]
    #[Groups(['sample:read', 'sample:write'])]
    private float $confidence = 0.0;

    #[ORM\Column(length: 255)]
    #[Groups(['sample:read', 'sample:write'])]
    private string $name = '';

    #[ORM\Column(nullable: true)]
    #[Groups(['sample:read', 'sample:write'])]
    private ?string $userName = null;

    #[ORM\Column]
    #[Groups(['sample:read', 'sample:write'])]
    private bool $favorite = false;

    #[ORM\Column(length: 32)]
    #[Groups(['sample:read', 'sample:write'])]
    private string $originVersion = '1.0.0';

    /** @var array<string, float> */
    #[ORM\Column(type: 'json', nullable: true)]
    #[Groups(['sample:read', 'sample:write'])]
    private ?array $classScores = null;

    #[ORM\Column(type: 'float', nullable: true)]
    #[Groups(['sample:read', 'sample:write'])]
    private ?float $loopScore = null;

    #[ORM\Column]
    #[Groups(['sample:read'])]
    private int $revision = 0;

    #[ORM\Column(nullable: true)]
    #[Groups(['sample:read'])]
    private ?\DateTimeImmutable $deletedAt = null;

    public function __construct(?string $id = null)
    {
        $this->id = $id ?? Uuid::v7()->toRfc4122();
        $this->sessionId = Uuid::v7()->toRfc4122();
    }

    public function getId(): string
    {
        return $this->id;
    }

    public function getSessionId(): string
    {
        return $this->sessionId;
    }

    public function setSessionId(string $sessionId): void
    {
        $this->sessionId = $sessionId;
    }

    public function getSourceOffsetMs(): int
    {
        return $this->sourceOffsetMs;
    }

    public function setSourceOffsetMs(int $sourceOffsetMs): void
    {
        $this->sourceOffsetMs = $sourceOffsetMs;
    }

    public function getDurationMs(): int
    {
        return $this->durationMs;
    }

    public function setDurationMs(int $durationMs): void
    {
        $this->durationMs = $durationMs;
    }

    public function getClass(): string
    {
        return $this->class;
    }

    public function setClass(string $class): void
    {
        $this->class = $class;
    }

    public function getConfidence(): float
    {
        return $this->confidence;
    }

    public function setConfidence(float $confidence): void
    {
        $this->confidence = $confidence;
    }

    public function getName(): string
    {
        return $this->name;
    }

    public function setName(string $name): void
    {
        $this->name = $name;
    }

    public function getUserName(): ?string
    {
        return $this->userName;
    }

    public function setUserName(?string $userName): void
    {
        $this->userName = $userName;
    }

    public function isFavorite(): bool
    {
        return $this->favorite;
    }

    public function setFavorite(bool $favorite): void
    {
        $this->favorite = $favorite;
    }

    public function getOriginVersion(): string
    {
        return $this->originVersion;
    }

    public function setOriginVersion(string $originVersion): void
    {
        $this->originVersion = $originVersion;
    }

    /** @return array<string, float>|null */
    public function getClassScores(): ?array
    {
        return $this->classScores;
    }

    /** @param array<string, float>|null $classScores */
    public function setClassScores(?array $classScores): void
    {
        $this->classScores = $classScores;
    }

    public function getLoopScore(): ?float
    {
        return $this->loopScore;
    }

    public function setLoopScore(?float $loopScore): void
    {
        $this->loopScore = $loopScore;
    }

    public function getRevision(): int
    {
        return $this->revision;
    }
}
