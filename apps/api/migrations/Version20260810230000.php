<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260810230000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Listen shares (unlisted MP3 listen links)';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('CREATE TABLE listen_shares (id UUID NOT NULL, token VARCHAR(64) NOT NULL, title VARCHAR(255) NOT NULL, visibility VARCHAR(16) NOT NULL, localProjectId VARCHAR(36) DEFAULT NULL, durationMs INT DEFAULT NULL, byteSize INT NOT NULL, storagePath VARCHAR(512) NOT NULL, createdAt TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL, updatedAt TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL, revokedAt TIMESTAMP(0) WITHOUT TIME ZONE DEFAULT NULL, owner_id UUID NOT NULL, PRIMARY KEY (id))');
        $this->addSql('CREATE UNIQUE INDEX uniq_listen_token ON listen_shares (token)');
        $this->addSql('CREATE INDEX IDX_91315D4D7E3C61F9 ON listen_shares (owner_id)');
        $this->addSql('ALTER TABLE listen_shares ADD CONSTRAINT FK_91315D4D7E3C61F9 FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE CASCADE NOT DEFERRABLE INITIALLY IMMEDIATE');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE listen_shares DROP CONSTRAINT FK_91315D4D7E3C61F9');
        $this->addSql('DROP TABLE listen_shares');
    }
}
