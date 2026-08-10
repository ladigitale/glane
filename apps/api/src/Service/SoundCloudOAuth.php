<?php

namespace App\Service;

use App\Entity\User;
use Doctrine\ORM\EntityManagerInterface;
use Psr\Cache\CacheItemPoolInterface;

/**
 * SoundCloud OAuth 2.1 (PKCE) + token refresh + track upload proxy (COEP-safe).
 */
final class SoundCloudOAuth
{
    private const AUTH_URL = 'https://secure.soundcloud.com/authorize';
    private const TOKEN_URL = 'https://secure.soundcloud.com/oauth/token';
    private const API_BASE = 'https://api.soundcloud.com';
    private const STATE_TTL = 600;
    private const STATE_PREFIX = 'sc_oauth_';

    private readonly string $clientId;
    private readonly string $clientSecret;
    private readonly string $redirectUri;
    private readonly string $frontUrl;

    public function __construct(
        private readonly EntityManagerInterface $em,
        private readonly CacheItemPoolInterface $cache,
    ) {
        $this->clientId = (string) ($_ENV['SOUNDCLOUD_CLIENT_ID'] ?? '');
        $this->clientSecret = (string) ($_ENV['SOUNDCLOUD_CLIENT_SECRET'] ?? '');
        $this->redirectUri = (string) ($_ENV['SOUNDCLOUD_REDIRECT_URI'] ?? '');
        $front = (string) ($_ENV['FRONT_URL'] ?? 'http://localhost:5173');
        $this->frontUrl = $front !== '' ? $front : 'http://localhost:5173';
    }

    public function isConfigured(): bool
    {
        return $this->clientId !== '' && $this->clientSecret !== '' && $this->redirectUri !== '';
    }

    /**
     * @return array{available: bool, connected: bool, displayName: ?string}
     */
    public function status(?User $user): array
    {
        if (!$this->isConfigured()) {
            return ['available' => false, 'connected' => false, 'displayName' => null];
        }
        if (!$user || !$user->getSoundcloudRefreshToken()) {
            return ['available' => true, 'connected' => false, 'displayName' => null];
        }

        return [
            'available' => true,
            'connected' => true,
            'displayName' => $user->getSoundcloudDisplayName(),
        ];
    }

    /**
     * @return array{url: string}
     */
    public function beginAuthorize(User $user): array
    {
        if (!$this->isConfigured()) {
            throw new \RuntimeException('SoundCloud is not configured');
        }

        $state = bin2hex(random_bytes(16));
        $verifier = $this->randomUrlSafe(64);
        $challenge = rtrim(strtr(base64_encode(hash('sha256', $verifier, true)), '+/', '-_'), '=');

        $item = $this->cache->getItem(self::STATE_PREFIX.$state);
        $item->set([
            'userId' => $user->getId(),
            'verifier' => $verifier,
        ]);
        $item->expiresAfter(self::STATE_TTL);
        $this->cache->save($item);

        $query = http_build_query([
            'client_id' => $this->clientId,
            'redirect_uri' => $this->redirectUri,
            'response_type' => 'code',
            'code_challenge' => $challenge,
            'code_challenge_method' => 'S256',
            'state' => $state,
        ]);

        return ['url' => self::AUTH_URL.'?'.$query];
    }

    public function handleCallback(string $code, string $state): string
    {
        $item = $this->cache->getItem(self::STATE_PREFIX.$state);
        if (!$item->isHit()) {
            throw new \RuntimeException('Invalid or expired OAuth state');
        }
        /** @var array{userId: string, verifier: string} $payload */
        $payload = $item->get();
        $this->cache->deleteItem(self::STATE_PREFIX.$state);

        $user = $this->em->find(User::class, $payload['userId']);
        if (!$user instanceof User) {
            throw new \RuntimeException('User not found');
        }

        $tokens = $this->exchangeToken([
            'grant_type' => 'authorization_code',
            'client_id' => $this->clientId,
            'client_secret' => $this->clientSecret,
            'redirect_uri' => $this->redirectUri,
            'code' => $code,
            'code_verifier' => $payload['verifier'],
        ]);

        $this->applyTokens($user, $tokens);
        $this->hydrateProfile($user);
        $this->em->flush();

        return rtrim($this->frontUrl, '/').'/?publish=soundcloud&ok=1#/project';
    }

    /**
     * @return array{access_token: string, token_type: string, expires_in?: int}
     */
    public function accessTokenFor(User $user): array
    {
        if (!$this->isConfigured()) {
            throw new \RuntimeException('SoundCloud is not configured');
        }
        $access = $user->getSoundcloudAccessToken();
        $expires = $user->getSoundcloudExpiresAt();
        if ($access && $expires && $expires > new \DateTimeImmutable('+60 seconds')) {
            return [
                'access_token' => $access,
                'token_type' => 'OAuth',
                'expires_in' => $expires->getTimestamp() - time(),
            ];
        }

        $refresh = $user->getSoundcloudRefreshToken();
        if (!$refresh) {
            throw new \RuntimeException('SoundCloud not connected');
        }

        $tokens = $this->exchangeToken([
            'grant_type' => 'refresh_token',
            'client_id' => $this->clientId,
            'client_secret' => $this->clientSecret,
            'refresh_token' => $refresh,
        ]);
        $this->applyTokens($user, $tokens);
        $this->em->flush();

        return [
            'access_token' => $user->getSoundcloudAccessToken() ?? '',
            'token_type' => 'OAuth',
            'expires_in' => max(0, ($user->getSoundcloudExpiresAt()?->getTimestamp() ?? time()) - time()),
        ];
    }

    public function disconnect(User $user): void
    {
        $user->clearSoundcloud();
        $this->em->flush();
    }

    /**
     * @return array{permalink_url: ?string, id: mixed}
     */
    public function uploadTrack(
        User $user,
        string $title,
        string $tmpPath,
        string $originalName,
        string $description = '',
        string $sharing = 'private',
    ): array {
        $tokenData = $this->accessTokenFor($user);
        $access = $tokenData['access_token'];

        $boundary = '----Glane'.bin2hex(random_bytes(8));
        $eol = "\r\n";
        $body = '';
        $fields = [
            'track[title]' => $title,
            'track[sharing]' => $sharing === 'public' ? 'public' : 'private',
        ];
        if ($description !== '') {
            $fields['track[description]'] = $description;
        }
        foreach ($fields as $name => $value) {
            $body .= '--'.$boundary.$eol;
            $body .= 'Content-Disposition: form-data; name="'.$name.'"'.$eol.$eol;
            $body .= $value.$eol;
        }
        $fileContents = file_get_contents($tmpPath);
        if ($fileContents === false) {
            throw new \RuntimeException('Cannot read upload');
        }
        $safeName = preg_replace('/[^\w.\-]+/', '_', $originalName) ?: 'track.mp3';
        $body .= '--'.$boundary.$eol;
        $body .= 'Content-Disposition: form-data; name="track[asset_data]"; filename="'.$safeName.'"'.$eol;
        $body .= 'Content-Type: audio/mpeg'.$eol.$eol;
        $body .= $fileContents.$eol;
        $body .= '--'.$boundary.'--'.$eol;

        $ctx = stream_context_create([
            'http' => [
                'method' => 'POST',
                'header' =>
                    "Authorization: OAuth {$access}\r\n".
                    "Accept: application/json; charset=utf-8\r\n".
                    "Content-Type: multipart/form-data; boundary={$boundary}\r\n",
                'content' => $body,
                'timeout' => 300,
                'ignore_errors' => true,
            ],
        ]);
        $raw = file_get_contents(self::API_BASE.'/tracks', false, $ctx);
        if ($raw === false) {
            throw new \RuntimeException('SoundCloud upload failed');
        }
        /** @var array<string, mixed> $json */
        $json = json_decode($raw, true) ?? [];
        if (!isset($json['id']) && !isset($json['permalink_url'])) {
            $msg = isset($json['error']) ? (string) $json['error'] : 'upload rejected';
            throw new \RuntimeException('SoundCloud: '.$msg);
        }

        return [
            'permalink_url' => isset($json['permalink_url']) ? (string) $json['permalink_url'] : null,
            'id' => $json['id'] ?? null,
        ];
    }

    /**
     * @param array<string, string> $fields
     * @return array<string, mixed>
     */
    private function exchangeToken(array $fields): array
    {
        $body = http_build_query($fields);
        $ctx = stream_context_create([
            'http' => [
                'method' => 'POST',
                'header' => "Content-Type: application/x-www-form-urlencoded\r\nAccept: application/json\r\n",
                'content' => $body,
                'timeout' => 30,
                'ignore_errors' => true,
            ],
        ]);
        $raw = file_get_contents(self::TOKEN_URL, false, $ctx);
        if ($raw === false) {
            throw new \RuntimeException('SoundCloud token request failed');
        }
        /** @var array<string, mixed> $json */
        $json = json_decode($raw, true) ?? [];
        if (!isset($json['access_token'])) {
            $msg = isset($json['error']) ? (string) $json['error'] : 'token exchange failed';
            throw new \RuntimeException('SoundCloud: '.$msg);
        }

        return $json;
    }

    /**
     * @param array<string, mixed> $tokens
     */
    private function applyTokens(User $user, array $tokens): void
    {
        $user->setSoundcloudAccessToken((string) $tokens['access_token']);
        if (isset($tokens['refresh_token'])) {
            $user->setSoundcloudRefreshToken((string) $tokens['refresh_token']);
        }
        $expiresIn = isset($tokens['expires_in']) ? (int) $tokens['expires_in'] : 3600;
        $user->setSoundcloudExpiresAt(new \DateTimeImmutable('+'.$expiresIn.' seconds'));
    }

    private function hydrateProfile(User $user): void
    {
        $token = $user->getSoundcloudAccessToken();
        if (!$token) {
            return;
        }
        $ctx = stream_context_create([
            'http' => [
                'method' => 'GET',
                'header' => "Authorization: OAuth {$token}\r\nAccept: application/json\r\n",
                'timeout' => 20,
                'ignore_errors' => true,
            ],
        ]);
        $raw = @file_get_contents(self::API_BASE.'/me', false, $ctx);
        if ($raw === false) {
            return;
        }
        /** @var array<string, mixed> $me */
        $me = json_decode($raw, true) ?? [];
        if (isset($me['id'])) {
            $user->setSoundcloudUserId((string) $me['id']);
        }
        $name = $me['username'] ?? $me['full_name'] ?? null;
        if (is_string($name) && $name !== '') {
            $user->setSoundcloudDisplayName($name);
        }
    }

    private function randomUrlSafe(int $bytes): string
    {
        return rtrim(strtr(base64_encode(random_bytes($bytes)), '+/', '-_'), '=');
    }
}
