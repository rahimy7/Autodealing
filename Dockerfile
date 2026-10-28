FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY index.html /srv/index.html
COPY css/premier.css /srv/css/premier.css
COPY js/premier.js /srv/js/premier.js
COPY img/premier-logo.png /srv/img/premier-logo.png
COPY data/inventory.json /srv/data/inventory.json
