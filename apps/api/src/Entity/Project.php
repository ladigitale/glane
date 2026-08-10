<?php

namespace App\Entity;

use ApiPlatform\Metadata\ApiResource;
use ApiPlatform\Metadata\Get;
use ApiPlatform\Metadata\GetCollection;
use ApiPlatform\Metadata\Patch;
use ApiPlatform\Metadata\Post;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Serializer\Attribute\Groups;
use Symfony\Component\Uid\Uuid;

#[ORM\Entity]
#[ORM\Table(name: 'projects')]
#[ApiResource(
    operations: [new GetCollection(), new Get(), new Post(), new Patch()],
    normalizationContext: ['groups' => ['project:read']],
    denormalizationContext: ['groups' => ['project:write']],
    paginationEnabled: false,
)]
class Project
{
    #[ORM\Id]
    #[ORM\Column(type: 'uuid', unique: true)]
    #[Groups(['project:read'])]
    private string $id;

    #[ORM\Column(length: 255)]
    #[Groups(['project:read', 'project:write'])]
    private string $title = 'Untitled';

    #[ORM\Column(type: 'float')]
    #[Groups(['project:read', 'project:write'])]
    private float $bpm = 120.0;

    /** @var array{0: int, 1: int} */
    #[ORM\Column(type: 'json')]
    #[Groups(['project:read', 'project:write'])]
    private array $timeSignature = [4, 4];

    #[ORM\Column]
    #[Groups(['project:read', 'project:write'])]
    private int $bars = 16;

    #[ORM\Column(type: 'float')]
    #[Groups(['project:read', 'project:write'])]
    private float $masterGainDb = 0.0;

    #[ORM\Column]
    #[Groups(['project:read', 'project:write'])]
    private int $revision = 0;

    #[ORM\Column(nullable: true)]
    #[Groups(['project:read'])]
    private ?\DateTimeImmutable $deletedAt = null;

    public function __construct(?string $id = null)
    {
        $this->id = $id ?? Uuid::v7()->toRfc4122();
    }

    public function getId(): string
    {
        return $this->id;
    }

    public function getTitle(): string
    {
        return $this->title;
    }

    public function setTitle(string $title): void
    {
        $this->title = $title;
    }

    public function getBpm(): float
    {
        return $this->bpm;
    }

    public function setBpm(float $bpm): void
    {
        $this->bpm = $bpm;
    }

    /** @return array{0: int, 1: int} */
    public function getTimeSignature(): array
    {
        return $this->timeSignature;
    }

    /** @param array{0: int, 1: int} $timeSignature */
    public function setTimeSignature(array $timeSignature): void
    {
        $this->timeSignature = $timeSignature;
    }

    public function getBars(): int
    {
        return $this->bars;
    }

    public function setBars(int $bars): void
    {
        $this->bars = $bars;
    }

    public function getMasterGainDb(): float
    {
        return $this->masterGainDb;
    }

    public function setMasterGainDb(float $masterGainDb): void
    {
        $this->masterGainDb = $masterGainDb;
    }

    public function getRevision(): int
    {
        return $this->revision;
    }

    public function setRevision(int $revision): void
    {
        $this->revision = $revision;
    }
}
