FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY admin ./admin
COPY index.html ./
COPY css ./css
COPY js ./js
COPY img ./img
USER node
EXPOSE 8080
CMD ["node", "server/index.js"]
