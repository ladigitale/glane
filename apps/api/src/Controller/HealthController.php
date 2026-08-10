<?php

namespace App\Controller;

use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\Routing\Attribute\Route;

final class HealthController extends AbstractController
{
    #[Route('/api/health', name: 'api_health', methods: ['GET'])]
    public function __invoke(): JsonResponse
    {
        return $this->json([
            'ok' => true,
            'app' => $_ENV['APP_NAME'] ?? 'Glane',
            'mercure' => ($_ENV['MERCURE_ENABLED'] ?? '0') === '1',
        ]);
    }
}
