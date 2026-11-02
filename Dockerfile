# Multi-stage Dockerfile for All-in-One Clinic Management System (Frontend + Backend + MySQL)

# Stage 1: Build React Frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci || npm install

COPY frontend/ ./
ENV VITE_API_BASE=/api/v1
RUN npm run build

# Stage 2: Runtime Image with PHP 8.3, MariaDB/MySQL, Nginx, and Supervisord
FROM alpine:3.20

# Install runtime packages
RUN apk add --no-cache \
    bash \
    curl \
    gettext \
    mariadb \
    mariadb-client \
    nginx \
    supervisor \
    php83 \
    php83-fpm \
    php83-pdo_mysql \
    php83-mbstring \
    php83-openssl \
    php83-tokenizer \
    php83-xml \
    php83-ctype \
    php83-json \
    php83-session \
    php83-curl \
    php83-zip \
    php83-gd \
    php83-bcmath \
    php83-pcntl \
    php83-posix \
    php83-gmp \
    php83-phar \
    php83-dom \
    php83-xmlwriter \
    php83-simplexml \
    php83-fileinfo \
    php83-intl \
    composer

# Symlink php binary
RUN ln -sf /usr/bin/php83 /usr/bin/php

# Setup runtime directories
RUN mkdir -p /run/mysqld /var/lib/mysql /run/nginx /run/php /var/log/supervisor /etc/nginx/templates /var/www/frontend /var/www/backend \
    && chown -R mysql:mysql /run/mysqld /var/lib/mysql \
    && chown -R nobody:nobody /run/nginx

# Configure PHP-FPM to listen on 127.0.0.1:9000
RUN sed -i 's|^listen = .*|listen = 127.0.0.1:9000|' /etc/php83/php-fpm.d/www.conf \
    && sed -i 's|^;clear_env = no|clear_env = no|' /etc/php83/php-fpm.d/www.conf

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
    && chown -R nobody:nobody storage bootstrap/cache

EXPOSE 10000

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
