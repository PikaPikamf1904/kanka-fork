# Minimal PHP 8.4 CLI image for running the Pest suite and PHPStan without Sail.
# Ubuntu 25.10 ships PHP 8.4 in its main archive, so no third-party PPA is needed.
#
#   docker build -t kanka-php84 docs/dragonlance/php84-test-image
#   docker run --rm -v "$PWD":/app -w /app kanka-php84 composer install
#   docker run --rm -v "$PWD":/app -w /app kanka-php84 php artisan passport:keys --env=testing
#   docker run --rm -v "$PWD":/app -w /app kanka-php84 vendor/bin/pest --compact
#
# Not a production image: it has no web server, no hardening, and runs as root.
FROM ubuntu:25.10

RUN apt-get update -qq \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends \
        ca-certificates git unzip curl \
        php8.4-cli php8.4-bcmath php8.4-intl php8.4-gd php8.4-zip php8.4-mbstring \
        php8.4-xml php8.4-curl php8.4-sqlite3 php8.4-mysql php8.4-gmp php8.4-redis php8.4-igbinary \
    && curl -sS https://getcomposer.org/installer | php -- --install-dir=/usr/local/bin --filename=composer \
    && rm -rf /var/lib/apt/lists/*
