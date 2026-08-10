<?php

namespace App\Controller;

use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Routing\Attribute\Route;

final class SyncOpsController extends AbstractController
{
    #[Route('/api/sync/ops', name: 'api_sync_ops', methods: ['POST'])]
    public function __invoke(Request $request): JsonResponse
    {
        $payload = json_decode($request->getContent(), true);
        $ops = \is_array($payload) && isset($payload['ops']) && \is_array($payload['ops'])
            ? $payload['ops']
            : [];

        return $this->json([
            'accepted' => \count($ops),
            'revision' => time(),
        ]);
    }
}
