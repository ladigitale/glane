<?php

namespace App\Controller;

use App\Entity\User;
use App\Service\SoundCloudOAuth;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\RedirectResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;

final class SoundCloudPublishController extends AbstractController
{
    public function __construct(
        private readonly SoundCloudOAuth $soundCloud,
    ) {
    }

    #[Route('/api/publish/soundcloud/status', name: 'api_publish_sc_status', methods: ['GET'])]
    public function status(): JsonResponse
    {
        $user = $this->getUser();
        $u = $user instanceof User ? $user : null;

        return $this->json($this->soundCloud->status($u));
    }

    #[Route('/api/publish/soundcloud/authorize', name: 'api_publish_sc_authorize', methods: ['GET'])]
    public function authorize(): JsonResponse
    {
        $user = $this->getUser();
        if (!$user instanceof User) {
            return $this->json(['error' => 'authentication_required'], Response::HTTP_UNAUTHORIZED);
        }
        if (!$this->soundCloud->isConfigured()) {
            return $this->json(['error' => 'unavailable'], Response::HTTP_SERVICE_UNAVAILABLE);
        }
        try {
            return $this->json($this->soundCloud->beginAuthorize($user));
        } catch (\Throwable $e) {
            return $this->json(['error' => $e->getMessage()], Response::HTTP_BAD_REQUEST);
        }
    }

    #[Route('/api/publish/soundcloud/callback', name: 'api_publish_sc_callback', methods: ['GET'])]
    public function callback(Request $request): Response
    {
        $code = (string) $request->query->get('code', '');
        $state = (string) $request->query->get('state', '');
        $err = (string) $request->query->get('error', '');
        if ($err !== '') {
            return new RedirectResponse($this->frontFail($err));
        }
        if ($code === '' || $state === '') {
            return new RedirectResponse($this->frontFail('missing_code'));
        }
        try {
            return new RedirectResponse($this->soundCloud->handleCallback($code, $state));
        } catch (\Throwable $e) {
            return new RedirectResponse($this->frontFail(rawurlencode($e->getMessage())));
        }
    }

    #[Route('/api/publish/soundcloud/token', name: 'api_publish_sc_token', methods: ['POST'])]
    public function token(): JsonResponse
    {
        $user = $this->getUser();
        if (!$user instanceof User) {
            return $this->json(['error' => 'authentication_required'], Response::HTTP_UNAUTHORIZED);
        }
        try {
            return $this->json($this->soundCloud->accessTokenFor($user));
        } catch (\Throwable $e) {
            return $this->json(['error' => $e->getMessage()], Response::HTTP_BAD_REQUEST);
        }
    }

    #[Route('/api/publish/soundcloud/tracks', name: 'api_publish_sc_tracks', methods: ['POST'])]
    public function tracks(Request $request): JsonResponse
    {
        $user = $this->getUser();
        if (!$user instanceof User) {
            return $this->json(['error' => 'authentication_required'], Response::HTTP_UNAUTHORIZED);
        }
        $file = $request->files->get('asset');
        if (!$file) {
            return $this->json(['error' => 'missing_asset'], Response::HTTP_BAD_REQUEST);
        }
        $title = trim((string) $request->request->get('title', 'Glane export'));
        $description = (string) $request->request->get('description', '');
        $sharing = (string) $request->request->get('sharing', 'private');
        try {
            $result = $this->soundCloud->uploadTrack(
                $user,
                $title !== '' ? $title : 'Glane export',
                $file->getPathname(),
                $file->getClientOriginalName() ?: 'track.mp3',
                $description,
                $sharing,
            );

            return $this->json($result);
        } catch (\Throwable $e) {
            return $this->json(['error' => $e->getMessage()], Response::HTTP_BAD_REQUEST);
        }
    }

    #[Route('/api/publish/soundcloud', name: 'api_publish_sc_disconnect', methods: ['DELETE'])]
    public function disconnect(): JsonResponse
    {
        $user = $this->getUser();
        if (!$user instanceof User) {
            return $this->json(['error' => 'authentication_required'], Response::HTTP_UNAUTHORIZED);
        }
        $this->soundCloud->disconnect($user);

        return $this->json(['ok' => true]);
    }

    private function frontFail(string $reason): string
    {
        $front = $_ENV['FRONT_URL'] ?? $_SERVER['FRONT_URL'] ?? 'http://localhost:5173';
        $base = rtrim((string) $front, '/');

        return $base.'/?publish=soundcloud&ok=0&error='.rawurlencode($reason).'#/project';
    }
}
