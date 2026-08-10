<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

/** Baseline schema for Glane API entities (users, projects, sessions, samples). */
final class Version20260809000000 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Baseline API tables (users, projects, sessions, samples)';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('CREATE TABLE users (id UUID NOT NULL, username VARCHAR(180) NOT NULL, roles JSON NOT NULL, password VARCHAR(255) NOT NULL, revision INT NOT NULL, deletedAt TIMESTAMP(0) WITHOUT TIME ZONE DEFAULT NULL, PRIMARY KEY (id))');
        $this->addSql('CREATE UNIQUE INDEX UNIQ_1483A5E9F85E0677 ON users (username)');
        $this->addSql('CREATE TABLE projects (id UUID NOT NULL, title VARCHAR(255) NOT NULL, bpm DOUBLE PRECISION NOT NULL, timeSignature JSON NOT NULL, bars INT NOT NULL, masterGainDb DOUBLE PRECISION NOT NULL, revision INT NOT NULL, deletedAt TIMESTAMP(0) WITHOUT TIME ZONE DEFAULT NULL, PRIMARY KEY (id))');
        $this->addSql('CREATE TABLE sessions (id UUID NOT NULL, startedAt TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL, endedAt TIMESTAMP(0) WITHOUT TIME ZONE DEFAULT NULL, durationMs INT NOT NULL, sampleRate INT NOT NULL, channelCount INT NOT NULL, status VARCHAR(32) NOT NULL, title VARCHAR(255) DEFAULT NULL, gapMarkers JSON NOT NULL, revision INT NOT NULL, deletedAt TIMESTAMP(0) WITHOUT TIME ZONE DEFAULT NULL, owner_id UUID DEFAULT NULL, PRIMARY KEY (id))');
        $this->addSql('CREATE INDEX IDX_9A609D137E3C61F9 ON sessions (owner_id)');
        $this->addSql('CREATE TABLE samples (id UUID NOT NULL, sessionId UUID NOT NULL, sourceOffsetMs INT NOT NULL, durationMs INT NOT NULL, class VARCHAR(32) NOT NULL, confidence DOUBLE PRECISION NOT NULL, name VARCHAR(255) NOT NULL, userName VARCHAR(255) DEFAULT NULL, favorite BOOLEAN NOT NULL, originVersion VARCHAR(32) NOT NULL, classScores JSON DEFAULT NULL, loopScore DOUBLE PRECISION DEFAULT NULL, revision INT NOT NULL, deletedAt TIMESTAMP(0) WITHOUT TIME ZONE DEFAULT NULL, PRIMARY KEY (id))');
        $this->addSql('ALTER TABLE sessions ADD CONSTRAINT FK_9A609D137E3C61F9 FOREIGN KEY (owner_id) REFERENCES users (id) NOT DEFERRABLE INITIALLY IMMEDIATE');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE sessions DROP CONSTRAINT FK_9A609D137E3C61F9');
        $this->addSql('DROP TABLE samples');
        $this->addSql('DROP TABLE sessions');
        $this->addSql('DROP TABLE projects');
        $this->addSql('DROP TABLE users');
    }
}
