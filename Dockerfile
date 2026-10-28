FROM caddy:2-alpine

COPY Caddyfile /etc/caddy/Caddyfile

# solo los archivos públicos del sitio (tools/ y README quedan fuera)
COPY index.html /srv/
COPY css /srv/css
COPY js /srv/js
COPY img /srv/img
