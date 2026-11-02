#!/bin/sh
set -e

echo "==> [init-app] Waiting for MariaDB socket..."
for i in $(seq 1 60); do
    if mariadb-admin --socket=/run/mysqld/mysqld.sock ping --silent; then
        echo "==> [init-app] MariaDB is ready!"
        break
    fi
    sleep 1
done

echo "==> [init-app] Creating CMS database and user..."
mariadb --socket=/run/mysqld/mysqld.sock -u root <<EOF
CREATE DATABASE IF NOT EXISTS cms CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'cms'@'localhost' IDENTIFIED BY 'cms_password';
CREATE USER IF NOT EXISTS 'cms'@'127.0.0.1' IDENTIFIED BY 'cms_password';
CREATE USER IF NOT EXISTS 'cms'@'%' IDENTIFIED BY 'cms_password';
GRANT ALL PRIVILEGES ON cms.* TO 'cms'@'localhost';
GRANT ALL PRIVILEGES ON cms.* TO 'cms'@'127.0.0.1';
GRANT ALL PRIVILEGES ON cms.* TO 'cms'@'%';
FLUSH PRIVILEGES;
EOF

echo "==> [init-app] Configuring Laravel .env..."
cd /var/www/backend

if [ ! -f .env ]; then
    cp .env.example .env
fi

sed -i 's/^DB_CONNECTION=.*/DB_CONNECTION=mysql/' .env
sed -i 's/^# DB_HOST=.*/DB_HOST=127.0.0.1/' .env
sed -i 's/^DB_HOST=.*/DB_HOST=127.0.0.1/' .env
sed -i 's/^# DB_PORT=.*/DB_PORT=3306/' .env
sed -i 's/^DB_PORT=.*/DB_PORT=3306/' .env
sed -i 's/^# DB_DATABASE=.*/DB_DATABASE=cms/' .env
sed -i 's/^DB_DATABASE=.*/DB_DATABASE=cms/' .env
sed -i 's/^# DB_USERNAME=.*/DB_USERNAME=cms/' .env
sed -i 's/^DB_USERNAME=.*/DB_USERNAME=cms/' .env
sed -i 's/^# DB_PASSWORD=.*/DB_PASSWORD=cms_password/' .env
sed -i 's/^DB_PASSWORD=.*/DB_PASSWORD=cms_password/' .env
sed -i 's|^# DB_SOCKET=.*|DB_SOCKET=/run/mysqld/mysqld.sock|' .env
if ! grep -q "DB_SOCKET=" .env; then
    echo "DB_SOCKET=/run/mysqld/mysqld.sock" >> .env
fi

# Reverb Configuration
sed -i 's/^BROADCAST_CONNECTION=.*/BROADCAST_CONNECTION=reverb/' .env
sed -i 's/^REVERB_APP_ID=.*/REVERB_APP_ID=clinic-local/' .env
sed -i 's/^REVERB_APP_KEY=.*/REVERB_APP_KEY=clinic-local-key/' .env
sed -i 's/^REVERB_APP_SECRET=.*/REVERB_APP_SECRET=local-development-only-change-in-production/' .env
sed -i 's/^REVERB_HOST=.*/REVERB_HOST=127.0.0.1/' .env
sed -i 's/^REVERB_PORT=.*/REVERB_PORT=8080/' .env
sed -i 's/^REVERB_SCHEME=.*/REVERB_SCHEME=http/' .env
sed -i 's/^REVERB_SERVER_HOST=.*/REVERB_SERVER_HOST=0.0.0.0/' .env
sed -i 's/^REVERB_SERVER_PORT=.*/REVERB_SERVER_PORT=8080/' .env
sed -i 's/^REVERB_ALLOWED_ORIGINS=.*/REVERB_ALLOWED_ORIGINS=*/' .env

sed -i 's/^APP_ENV=.*/APP_ENV=production/' .env
sed -i 's/^APP_DEBUG=.*/APP_DEBUG=false/' .env

if ! grep -q "APP_KEY=base64:" .env; then
    php artisan key:generate --force
fi

echo "==> [init-app] Running Laravel database migrations..."
php artisan migrate --force

echo "==> [init-app] Setting up storage symlink..."
php artisan storage:link || true

echo "==> [init-app] Caching configuration and routes..."
php artisan config:cache || true
php artisan route:cache || true
php artisan view:cache || true

chown -R www-data:www-data /var/www/backend/storage /var/www/backend/bootstrap/cache

# Restart reverb and queue-worker now that .env and migrations are ready
supervisorctl restart reverb || true
supervisorctl restart queue-worker || true

echo "==> [init-app] Clinic Management System & Reverb are fully ready and online!"
