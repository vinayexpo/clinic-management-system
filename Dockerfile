# Stage 1: Build React Frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci || npm install

COPY frontend/ ./
ENV VITE_API_BASE=/api/v1
RUN npm run build

# Stage 2: Runtime Image with PHP 8.4, MariaDB/MySQL, Nginx, and Supervisord
FROM php:8.4-fpm-alpine

# Install system dependencies
RUN apk add --no-cache \
    bash \
    curl \
    gettext \
    mariadb \
    mariadb-client \
    nginx \
    supervisor \
    libpng-dev \
    libjpeg-turbo-dev \
    freetype-dev \
    libzip-dev \
    zip \
    unzip \
    icu-dev

# Install PHP extensions
RUN docker-php-ext-configure gd --with-freetype --with-jpeg \
    && docker-php-ext-install -j$(nproc) pdo_mysql bcmath pcntl gd zip intl

# Install Composer
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

# Setup runtime directories
RUN mkdir -p /run/mysqld /var/lib/mysql /run/nginx /run/php /var/log/supervisor /etc/nginx/templates /var/www/frontend /var/www/backend \
    && chown -R mysql:mysql /run/mysqld /var/lib/mysql \
    && chown -R www-data:www-data /run/nginx

# Configure PHP-FPM to listen on 127.0.0.1:9000
RUN echo "[global]" > /usr/local/etc/php-fpm.d/zz-docker.conf \
    && echo "daemonize = no" >> /usr/local/etc/php-fpm.d/zz-docker.conf \
    && echo "[www]" >> /usr/local/etc/php-fpm.d/zz-docker.conf \
    && echo "listen = 127.0.0.1:9000" >> /usr/local/etc/php-fpm.d/zz-docker.conf \
    && echo "clear_env = no" >> /usr/local/etc/php-fpm.d/zz-docker.conf

# Copy configuration files
COPY docker/nginx.conf.template /etc/nginx/templates/nginx.conf.template
COPY docker/supervisord.conf /etc/supervisor/supervisord.conf
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Copy built frontend assets
COPY --from=frontend-builder /app/frontend/dist /var/www/frontend

# Copy backend dependencies and source
WORKDIR /var/www/backend
COPY backend/composer.json backend/composer.lock ./
RUN composer install --no-dev --no-interaction --prefer-dist --optimize-autoloader --no-scripts

COPY backend/ ./
RUN composer dump-autoload --optimize --no-dev

# Setup backend storage directories and permissions
RUN mkdir -p storage/framework/cache/data storage/framework/sessions storage/framework/views storage/logs bootstrap/cache \
    && chmod -R 775 storage bootstrap/cache \
    && chown -R www-data:www-data storage bootstrap/cache

EXPOSE 10000

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
