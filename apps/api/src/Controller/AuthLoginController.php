<?php

declare(strict_types=1);

namespace App\Controller;

use Symfony\Component\HttpKernel\Attribute\AsController;
use Symfony\Component\Routing\Attribute\Route;

/**
 * Route stub for json_login check_path — firewall intercepts before this runs.
 */
#[AsController]
final class AuthLoginController
{
    #[Route('/api/auth/login', name: 'api_auth_login', methods: ['POST'])]
    public function __invoke(): never
    {
        throw new \LogicException('Handled by security json_login firewall.');
    }
}
