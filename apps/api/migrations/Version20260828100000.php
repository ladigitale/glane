<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260828100000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Listen shares — expiresAt (TTL)';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('ALTER TABLE listen_shares ADD expiresAt TIMESTAMP(0) WITHOUT TIME ZONE DEFAULT NULL');
        $this->addSql('CREATE INDEX idx_listen_expires ON listen_shares (expiresAt)');
        // Backfill: existing rows expire 30 days after creation.
        $this->addSql("UPDATE listen_shares SET expiresAt = createdAt + INTERVAL '30 days' WHERE expiresAt IS NULL");
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP INDEX idx_listen_expires');
        $this->addSql('ALTER TABLE listen_shares DROP expiresAt');
    }
}
