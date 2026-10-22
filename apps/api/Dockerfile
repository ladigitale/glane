#syntax=docker/dockerfile:1

# Versions
FROM dunglas/frankenphp:1-php8.4 AS frankenphp_upstream

# Garde-fou sécurité PHP2Shell (CVE-2026-109618 / CVE-2026-109619, RCE sans authentification,
# corrigées dans PHP 8.5.12 / 8.4.27 / 8.3.36 / 8.2.35) : le build échoue si l'image de base,
# éventuellement restée en cache, embarque un PHP plus ancien. Reconstruire avec `--pull`.
RUN php -r '$m=["8.5"=>"8.5.12","8.4"=>"8.4.27","8.3"=>"8.3.36","8.2"=>"8.2.35"][PHP_MAJOR_VERSION.".".PHP_MINOR_VERSION]??null; if($m===null||version_compare(PHP_VERSION,$m,"<")){fwrite(STDERR,"PHP ".PHP_VERSION." vulnérable (CVE-2026-109618/109619) : minimum ".($m??"inconnu")." — reconstruire avec --pull.\n");exit(1);} echo "PHP ".PHP_VERSION." OK\n";'

# The different stages of this Dockerfile are meant to be built into separate images
# https://docs.docker.com/develop/develop-images/multistage-build/#stop-at-a-specific-build-stage
# https://docs.docker.com/compose/compose-file/#target


# Base FrankenPHP image
FROM frankenphp_upstream AS frankenphp_base

WORKDIR /app

VOLUME /app/var/

# persistent / runtime deps
# hadolint ignore=DL3008
RUN apt-get update && apt-get install -y --no-install-recommends \
	file \
	git \
	&& rm -rf /var/lib/apt/lists/*

RUN set -eux; \
	install-php-extensions \
		@composer \
		apcu \
		gmp \
		intl \
		opcache \
		pdo_pgsql \
		zip \
	;

# https://getcomposer.org/doc/03-cli.md#composer-allow-superuser
ENV COMPOSER_ALLOW_SUPERUSER=1

# Transport to use by Mercure (default to Bolt)
ENV MERCURE_TRANSPORT_URL=bolt:///data/mercure.db

ENV PHP_INI_SCAN_DIR=":$PHP_INI_DIR/app.conf.d"

###> recipes ###
###< recipes ###

COPY --link frankenphp/conf.d/10-app.ini $PHP_INI_DIR/app.conf.d/
COPY --link --chmod=755 frankenphp/docker-entrypoint.sh /usr/local/bin/docker-entrypoint
COPY --link frankenphp/Caddyfile /etc/frankenphp/Caddyfile

ENTRYPOINT ["docker-entrypoint"]

HEALTHCHECK --start-period=60s CMD curl -f http://localhost:2019/metrics || exit 1
CMD [ "frankenphp", "run", "--config", "/etc/frankenphp/Caddyfile" ]

# Dev FrankenPHP image
FROM frankenphp_base AS frankenphp_dev

ENV APP_ENV=dev
ENV XDEBUG_MODE=off
ENV FRANKENPHP_WORKER_CONFIG=watch

RUN mv "$PHP_INI_DIR/php.ini-development" "$PHP_INI_DIR/php.ini"

RUN set -eux; \
	install-php-extensions \
		xdebug \
	;

COPY --link frankenphp/conf.d/20-app.dev.ini $PHP_INI_DIR/app.conf.d/

CMD [ "frankenphp", "run", "--config", "/etc/frankenphp/Caddyfile", "--watch" ]

# Prod FrankenPHP image
FROM frankenphp_base AS frankenphp_prod

ENV APP_ENV=prod

RUN mv "$PHP_INI_DIR/php.ini-production" "$PHP_INI_DIR/php.ini"

COPY --link frankenphp/conf.d/20-app.prod.ini $PHP_INI_DIR/app.conf.d/

# prevent the reinstallation of vendors at every changes in the source code
COPY --link composer.* symfony.* ./
RUN set -eux; \
	composer install --no-cache --prefer-dist --no-dev --no-autoloader --no-scripts --no-progress

# copy sources
COPY --link --exclude=frankenphp/ . ./

RUN set -eux; \
	mkdir -p var/cache var/log var/share; \
	composer dump-autoload --classmap-authoritative --no-dev; \
	composer dump-env prod; \
	composer run-script --no-dev post-install-cmd; \
	chmod +x bin/console; sync;
