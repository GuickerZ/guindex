#!/bin/bash
# ================================================================
# GuIndex - Setup torrent-indexer na VPS
# Execute como root: bash setup-indexer.sh
# ================================================================

set -e

echo "=== [1/5] Instalando Docker (se nao tiver) ==="
if ! command -v docker &> /dev/null; then
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
  echo "Docker instalado!"
else
  echo "Docker ja instalado: $(docker --version)"
fi

echo ""
echo "=== [2/5] Instalando Nginx + Certbot ==="
apt-get update -qq
apt-get install -y -qq nginx certbot python3-certbot-nginx > /dev/null 2>&1
echo "Nginx + Certbot instalados!"

echo ""
echo "=== [3/5] Iniciando torrent-indexer ==="
# Para container antigo se existir
docker stop torrent-indexer 2>/dev/null || true
docker rm torrent-indexer 2>/dev/null || true

docker run -d \
  --name torrent-indexer \
  --restart unless-stopped \
  -p 127.0.0.1:8080:8080 \
  ghcr.io/felipemarinho97/torrent-indexer:latest

echo "torrent-indexer rodando na porta 8080!"

echo ""
echo "=== [4/5] Configurando Nginx reverse proxy ==="

# Pergunte o dominio
read -p "Digite o dominio (ex: indexer.guindex.com): " DOMAIN

cat > /etc/nginx/sites-available/torrent-indexer << EOF
server {
    listen 80;
    server_name $DOMAIN;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 300s;
    }
}
EOF

ln -sf /etc/nginx/sites-available/torrent-indexer /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

echo "Nginx configurado para $DOMAIN!"

echo ""
echo "=== [5/5] Gerando certificado SSL ==="
certbot --nginx -d $DOMAIN --non-interactive --agree-tos --register-unsafely-without-email || {
  echo "AVISO: Certbot falhou. Verifique se o DNS do dominio ja aponta para este servidor."
  echo "Depois rode manualmente: certbot --nginx -d $DOMAIN"
}

echo ""
echo "============================================"
echo "  PRONTO!"
echo "  torrent-indexer rodando em: https://$DOMAIN"
echo "  Configure no GuIndex:"
echo "  TORRENT_INDEXER_URL=https://$DOMAIN"
echo "============================================"
