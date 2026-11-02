#!/bin/sh
set -e

export PORT="${PORT:-10000}"

echo "==> Configuring Nginx on port ${PORT}..."
envsubst '${PORT}' < /etc/nginx/templates/nginx.conf.template > /etc/nginx/http.d/default.conf

echo "==> Initializing MariaDB / MySQL data directory..."
if [ ! -d "/var/lib/mysql/mysql" ]; then
    mariadb-install-db --user=mysql --datadir=/var/lib/mysql > /dev/null 2>&1
fi

echo "==> Starting temporary MariaDB to configure database and run migrations..."
/usr/bin/mysqld_safe --datadir=/var/lib/mysql --user=mysql --skip-networking &
MYSQL_PID=$!

echo "==> Waiting for MariaDB to become ready..."
for i in $(seq 1 30); do
    if mariadb-admin ping --socket=/run/mysqld/mysqld.sock --silent; then
        break
    fi
    sleep 1
done

echo "==> Creating CMS database and user..."
mariadb --socket=/run/mysqld/mysqld.sock -u root <<EOF
CREATE DATABASE IF NOT EXISTS cms CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'cms'@'localhost' IDENTIFIED BY 'cms_password';
CREATE USER IF NOT EXISTS 'cms'@'127.0.0.1' IDENTIFIED BY 'cms_password';
GRANT ALL PRIVILEGES ON cms.* TO 'cms'@'localhost';
GRANT ALL PRIVILEGES ON cms.* TO 'cms'@'127.0.0.1';
FLUSH PRIVILEGES;
EOF

echo "==> Configuring Laravel environment..."
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
sed -i 's/^APP_ENV=.*/APP_ENV=production/' .env
sed -i 's/^APP_DEBUG=.*/APP_DEBUG=false/' .env

if ! grep -q "APP_KEY=base64:" .env; then
    php artisan key:generate --force
fi

echo "==> Running Laravel database migrations..."
php artisan migrate --force

echo "==> Setting up storage link..."
php artisan storage:link || true

echo "==> Caching Laravel configuration and routes..."
php artisan config:cache
php artisan route:cache
php artisan view:cache

echo "==> Fixing permissions..."
chown -R www-data:www-data /var/www/backend/storage /var/www/backend/bootstrap/cache

echo "==> Stopping temporary MariaDB..."
mariadb-admin --socket=/run/mysqld/mysqld.sock -u root shutdown
wait $MYSQL_PID 2>/dev/null || true

echo "==> Starting all services via Supervisord..."
exec /usr/bin/supervisord -c /etc/supervisor/supervisord.conf
