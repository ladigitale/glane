<?php

namespace App\Controller;

use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Routing\Attribute\Route;

final class PresignController extends AbstractController
{
    #[Route('/api/assets/presign', name: 'api_assets_presign', methods: ['POST'])]
    public function __invoke(Request $request): JsonResponse
    {
        $payload = json_decode($request->getContent(), true) ?? [];
        $sampleId = \is_array($payload) ? ($payload['sampleId'] ?? 'unknown') : 'unknown';
        $kind = \is_array($payload) ? ($payload['kind'] ?? 'master') : 'master';

        return $this->json([
            'url' => sprintf('/api/assets/upload-stub/%s/%s', $sampleId, $kind),
            'headers' => ['Content-Type' => 'application/octet-stream'],
        ]);
    }
}
