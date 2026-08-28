<?php

declare(strict_types=1);

namespace App\Controller;

use App\Entity\User;
use Doctrine\ORM\EntityManagerInterface;
use Lexik\Bundle\JWTAuthenticationBundle\Services\JWTTokenManagerInterface;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;
use Symfony\Component\Routing\Attribute\Route;

final class AuthRegisterController extends AbstractController
{
    public function __construct(
        private readonly EntityManagerInterface $em,
        private readonly UserPasswordHasherInterface $passwordHasher,
        private readonly JWTTokenManagerInterface $jwtManager,
        #[Autowire('%app.auth_register_enabled%')]
        private readonly bool $registerEnabled,
    ) {
    }

    /** Stub for json_login check_path — firewall intercepts before this runs. */
    #[Route('/api/auth/login', name: 'api_auth_login', methods: ['POST'])]
    public function login(): never
    {
        throw new \LogicException('Handled by security json_login firewall.');
    }

    #[Route('/api/auth/register', name: 'api_auth_register', methods: ['POST'])]
    public function __invoke(Request $request): JsonResponse
    {
        if (!$this->registerEnabled) {
            return $this->json(['error' => 'registration_disabled'], Response::HTTP_FORBIDDEN);
        }

        $payload = json_decode($request->getContent(), true);
        if (!\is_array($payload)) {
            return $this->json(['error' => 'invalid_json'], Response::HTTP_BAD_REQUEST);
        }

        $username = trim((string) ($payload['username'] ?? ''));
        $password = (string) ($payload['password'] ?? '');

        if ($username === '' || \strlen($username) < 2 || \strlen($username) > 180) {
            return $this->json(['error' => 'invalid_username'], Response::HTTP_BAD_REQUEST);
        }
        if (\strlen($password) < 8) {
            return $this->json(['error' => 'invalid_password'], Response::HTTP_BAD_REQUEST);
        }

        $existing = $this->em->getRepository(User::class)->findOneBy(['username' => $username]);
        if ($existing !== null) {
            return $this->json(['error' => 'username_taken'], Response::HTTP_CONFLICT);
        }

        $user = new User();
        $user->setUsername($username);
        $user->setPassword($this->passwordHasher->hashPassword($user, $password));
        $user->setRoles(['ROLE_USER']);

        $this->em->persist($user);
        $this->em->flush();

        return $this->json([
            'token' => $this->jwtManager->create($user),
            'username' => $user->getUsername(),
        ], Response::HTTP_CREATED);
    }
}
