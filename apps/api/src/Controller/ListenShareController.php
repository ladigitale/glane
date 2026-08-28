<?php

declare(strict_types=1);

namespace App\Controller;

use App\Entity\ListenShare;
use App\Entity\User;
use App\Service\ListenShareStorage;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpFoundation\ResponseHeaderBag;
use Symfony\Component\Routing\Attribute\Route;

final class ListenShareController extends AbstractController
{
    public function __construct(
        private readonly ListenShareStorage $storage,
        private readonly EntityManagerInterface $em,
        #[Autowire('%env(default:app.public_url_fallback:APP_PUBLIC_URL)%')]
        private readonly string $appPublicUrl,
    ) {
    }

    #[Route('/api/listens', name: 'api_listens_create', methods: ['POST'])]
    public function create(Request $request): JsonResponse
    {
        $user = $this->getUser();
        if (!$user instanceof User) {
            return $this->json(['error' => 'authentication_required'], Response::HTTP_UNAUTHORIZED);
        }

        $file = $request->files->get('audio');
        if (!$file) {
            $tooLarge = $request->headers->get('Content-Length') !== null
                && (int) $request->headers->get('Content-Length') > 0
                && 0 === \count($request->request->all())
                && 0 === \count($request->files->all());

            return $this->json(
                ['error' => $tooLarge ? 'file_too_large' : 'missing_audio'],
                Response::HTTP_BAD_REQUEST,
            );
        }

        $title = trim((string) $request->request->get('title', ''));
        $visibility = (string) $request->request->get('visibility', ListenShare::VIS_UNLISTED);
        $localProjectId = $request->request->get('localProjectId');
        $durationRaw = $request->request->get('durationMs');
        $durationMs = is_numeric($durationRaw) ? (int) $durationRaw : null;

        try {
            $share = $this->storage->createFromUpload(
                $user,
                $file,
                $title,
                $visibility,
                is_string($localProjectId) ? $localProjectId : null,
                $durationMs,
            );
        } catch (\InvalidArgumentException $e) {
            return $this->json(['error' => $e->getMessage()], Response::HTTP_BAD_REQUEST);
        } catch (\LogicException $e) {
            // Symfony UploadedFile::getMimeType without symfony/mime — never surface raw message.
            return $this->json(['error' => 'invalid_mime'], Response::HTTP_BAD_REQUEST);
        } catch (\Throwable $e) {
            return $this->json(['error' => $e->getMessage()], Response::HTTP_INTERNAL_SERVER_ERROR);
        }

        return $this->json($this->serialize($share), Response::HTTP_CREATED);
    }

    #[Route('/api/listens/{token}', name: 'api_listens_get', methods: ['GET'])]
    public function get(string $token): JsonResponse
    {
        $share = $this->storage->findByToken($token);
        if (!$share) {
            return $this->json(['error' => 'not_found'], Response::HTTP_NOT_FOUND);
        }

        $user = $this->getUser();
        $isOwner = $user instanceof User && $user->getId() === $share->getOwner()->getId();
        if (!$share->isPubliclyReadable() && !$isOwner) {
            return $this->json(['error' => 'not_found'], Response::HTTP_NOT_FOUND);
        }

        return $this->json($this->serialize($share, includeAudio: true));
    }

    #[Route('/api/listens/{token}', name: 'api_listens_patch', methods: ['PATCH'])]
    public function patch(string $token, Request $request): JsonResponse
    {
        $user = $this->getUser();
        if (!$user instanceof User) {
            return $this->json(['error' => 'authentication_required'], Response::HTTP_UNAUTHORIZED);
        }

        $share = $this->storage->findByToken($token);
        if (!$share || $share->getOwner()->getId() !== $user->getId()) {
            return $this->json(['error' => 'not_found'], Response::HTTP_NOT_FOUND);
        }

        $payload = json_decode($request->getContent(), true);
        if (!\is_array($payload)) {
            return $this->json(['error' => 'invalid_json'], Response::HTTP_BAD_REQUEST);
        }

        if (isset($payload['title']) && \is_string($payload['title'])) {
            $share->setTitle(trim($payload['title']));
        }
        if (isset($payload['visibility']) && \is_string($payload['visibility'])) {
            try {
                $share->setVisibility($payload['visibility']);
            } catch (\InvalidArgumentException) {
                return $this->json(['error' => 'invalid_visibility'], Response::HTTP_BAD_REQUEST);
            }
        }
        if (!empty($payload['revoke'])) {
            $this->storage->revoke($share);
            return $this->json($this->serialize($share));
        }

        $this->em->flush();

        return $this->json($this->serialize($share));
    }

    #[Route('/api/listens/{token}/audio', name: 'api_listens_audio', methods: ['GET'])]
    public function audio(string $token): Response
    {
        $share = $this->storage->findByToken($token);
        if (!$share) {
            return new JsonResponse(['error' => 'not_found'], Response::HTTP_NOT_FOUND);
        }

        $user = $this->getUser();
        $isOwner = $user instanceof User && $user->getId() === $share->getOwner()->getId();
        if (!$share->isPubliclyReadable() && !$isOwner) {
            return new JsonResponse(['error' => 'not_found'], Response::HTTP_NOT_FOUND);
        }

        $path = $share->getStoragePath();
        if (!is_file($path)) {
            return new JsonResponse(['error' => 'missing_file'], Response::HTTP_NOT_FOUND);
        }

        $response = new BinaryFileResponse($path);
        $response->headers->set('Content-Type', 'audio/mpeg');
        // Front is COEP require-corp (ADR-0015); <audio src> is no-cors → needs CORP.
        $response->headers->set('Cross-Origin-Resource-Policy', 'cross-origin');
        $response->setContentDisposition(ResponseHeaderBag::DISPOSITION_INLINE, 'listen.mp3');

        return $response;
    }

    /** @return array<string, mixed> */
    private function serialize(ListenShare $share, bool $includeAudio = false): array
    {
        $front = rtrim($this->appPublicUrl !== '' ? $this->appPublicUrl : '', '/');
        $data = [
            'token' => $share->getToken(),
            'title' => $share->getTitle(),
            'visibility' => $share->getVisibility(),
            'localProjectId' => $share->getLocalProjectId(),
            'durationMs' => $share->getDurationMs(),
            'byteSize' => $share->getByteSize(),
            'url' => $front !== '' ? $front.'/listen/'.$share->getToken() : '/listen/'.$share->getToken(),
            'revoked' => $share->getRevokedAt() !== null,
            'expiresAt' => $share->getExpiresAt()?->format(\DateTimeInterface::ATOM),
            'expired' => $share->isExpired(),
        ];
        if ($includeAudio) {
            $data['audioUrl'] = '/api/listens/'.$share->getToken().'/audio';
        }

        return $data;
    }
}
