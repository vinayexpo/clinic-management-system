#!/bin/sh
set -e

export PORT="${PORT:-10000}"

echo "==> Configuring Nginx to listen on port ${PORT}..."
envsubst '${PORT}' < /etc/nginx/templates/nginx.conf.template > /etc/nginx/http.d/default.conf

if [ ! -d "/var/lib/mysql/mysql" ]; then
    echo "==> Initializing MariaDB data directory..."
    mariadb-install-db --user=mysql --datadir=/var/lib/mysql > /dev/null 2>&1
fi

mkdir -p /run/mysqld /run/nginx /run/php /var/log/supervisor
chown -R mysql:mysql /run/mysqld /var/lib/mysql
chown -R www-data:www-data /var/www/backend/storage /var/www/backend/bootstrap/cache /run/nginx

echo "==> Starting Supervisord (MariaDB, PHP-FPM, Nginx, and App-Init)..."
exec /usr/bin/supervisord -c /etc/supervisor/supervisord.conf
