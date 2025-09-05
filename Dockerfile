# Multi-stage build for Express API + React client
FROM node:18-alpine AS builder
WORKDIR /app

# Install root deps (for server build scripts if any)
COPY package.json package-lock.json ./
RUN npm ci

# Install and build client
COPY client/package.json client/package-lock.json ./client/
RUN cd client && npm ci

# Copy source and build client
COPY . .
RUN cd client && npm run build

# Runtime image
FROM node:18-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Install only production deps for server
COPY package.json package-lock.json ./
RUN npm ci --only=production

# Copy server code and built client
COPY server ./server
COPY server.js ./server.js
COPY client/build ./client/build

# Ensure data directory exists if filesystem fallback is used
RUN mkdir -p server/data

EXPOSE 5000
ENV PORT=5000
ENV HOST=0.0.0.0

CMD ["node", "server.js"]