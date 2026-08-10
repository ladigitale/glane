<?php

namespace App\Entity;

use ApiPlatform\Metadata\ApiResource;
use ApiPlatform\Metadata\Get;
use ApiPlatform\Metadata\GetCollection;
use ApiPlatform\Metadata\Patch;
use ApiPlatform\Metadata\Post;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Security\Core\User\PasswordAuthenticatedUserInterface;
use Symfony\Component\Security\Core\User\UserInterface;
use Symfony\Component\Serializer\Attribute\Groups;
use Symfony\Component\Uid\Uuid;

#[ORM\Entity]
#[ORM\Table(name: 'users')]
#[ApiResource(
    operations: [
        new GetCollection(security: "is_granted('ROLE_ADMIN')"),
        new Get(security: "is_granted('ROLE_USER')"),
        new Post(security: "is_granted('ROLE_ADMIN')"),
        new Patch(security: "is_granted('ROLE_USER')"),
    ],
    normalizationContext: ['groups' => ['user:read']],
    denormalizationContext: ['groups' => ['user:write']],
)]
class User implements UserInterface, PasswordAuthenticatedUserInterface
{
    #[ORM\Id]
    #[ORM\Column(type: 'uuid', unique: true)]
    #[Groups(['user:read'])]
    private string $id;

    #[ORM\Column(length: 180, unique: true)]
    #[Groups(['user:read', 'user:write'])]
    private string $username = '';

    /** @var list<string> */
    #[ORM\Column(type: 'json')]
    #[Groups(['user:read'])]
    private array $roles = [];

    #[ORM\Column]
    private string $password = '';

    #[ORM\Column]
    #[Groups(['user:read'])]
    private int $revision = 0;

    #[ORM\Column(nullable: true)]
    #[Groups(['user:read'])]
    private ?\DateTimeImmutable $deletedAt = null;

    /** SoundCloud OAuth tokens (POC: plaintext; encrypt later). */
    #[ORM\Column(type: 'text', nullable: true)]
    private ?string $soundcloudAccessToken = null;

    #[ORM\Column(type: 'text', nullable: true)]
    private ?string $soundcloudRefreshToken = null;

    #[ORM\Column(nullable: true)]
    private ?\DateTimeImmutable $soundcloudExpiresAt = null;

    #[ORM\Column(length: 64, nullable: true)]
    private ?string $soundcloudUserId = null;

    #[ORM\Column(length: 180, nullable: true)]
    private ?string $soundcloudDisplayName = null;

    public function __construct(?string $id = null)
    {
        $this->id = $id ?? Uuid::v7()->toRfc4122();
    }

    public function getId(): string
    {
        return $this->id;
    }

    public function getUserIdentifier(): string
    {
        return $this->username;
    }

    public function getUsername(): string
    {
        return $this->username;
    }

    public function setUsername(string $username): void
    {
        $this->username = $username;
    }

    public function getRoles(): array
    {
        $roles = $this->roles;
        $roles[] = 'ROLE_USER';

        return array_values(array_unique($roles));
    }

    /** @param list<string> $roles */
    public function setRoles(array $roles): void
    {
        $this->roles = $roles;
    }

    public function getPassword(): string
    {
        return $this->password;
    }

    public function setPassword(string $password): void
    {
        $this->password = $password;
    }

    public function eraseCredentials(): void
    {
    }

    public function getRevision(): int
    {
        return $this->revision;
    }

    public function getSoundcloudAccessToken(): ?string
    {
        return $this->soundcloudAccessToken;
    }

    public function setSoundcloudAccessToken(?string $token): void
    {
        $this->soundcloudAccessToken = $token;
    }

    public function getSoundcloudRefreshToken(): ?string
    {
        return $this->soundcloudRefreshToken;
    }

    public function setSoundcloudRefreshToken(?string $token): void
    {
        $this->soundcloudRefreshToken = $token;
    }

    public function getSoundcloudExpiresAt(): ?\DateTimeImmutable
    {
        return $this->soundcloudExpiresAt;
    }

    public function setSoundcloudExpiresAt(?\DateTimeImmutable $at): void
    {
        $this->soundcloudExpiresAt = $at;
    }

    public function getSoundcloudUserId(): ?string
    {
        return $this->soundcloudUserId;
    }

    public function setSoundcloudUserId(?string $id): void
    {
        $this->soundcloudUserId = $id;
    }

    public function getSoundcloudDisplayName(): ?string
    {
        return $this->soundcloudDisplayName;
    }

    public function setSoundcloudDisplayName(?string $name): void
    {
        $this->soundcloudDisplayName = $name;
    }

    public function clearSoundcloud(): void
    {
        $this->soundcloudAccessToken = null;
        $this->soundcloudRefreshToken = null;
        $this->soundcloudExpiresAt = null;
        $this->soundcloudUserId = null;
        $this->soundcloudDisplayName = null;
    }
}
