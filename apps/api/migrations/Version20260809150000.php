<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260809150000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Add SoundCloud OAuth token columns on users';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('ALTER TABLE users ADD soundcloudAccessToken TEXT DEFAULT NULL');
        $this->addSql('ALTER TABLE users ADD soundcloudRefreshToken TEXT DEFAULT NULL');
        $this->addSql('ALTER TABLE users ADD soundcloudExpiresAt TIMESTAMP(0) WITHOUT TIME ZONE DEFAULT NULL');
        $this->addSql('ALTER TABLE users ADD soundcloudUserId VARCHAR(64) DEFAULT NULL');
        $this->addSql('ALTER TABLE users ADD soundcloudDisplayName VARCHAR(180) DEFAULT NULL');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE users DROP soundcloudAccessToken');
        $this->addSql('ALTER TABLE users DROP soundcloudRefreshToken');
        $this->addSql('ALTER TABLE users DROP soundcloudExpiresAt');
        $this->addSql('ALTER TABLE users DROP soundcloudUserId');
        $this->addSql('ALTER TABLE users DROP soundcloudDisplayName');
    }
}
