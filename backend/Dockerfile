FROM node:20-alpine

# Set working directory
WORKDIR /app

# Install system dependencies (needed for some packages)
RUN apk add --no-cache python3 make g++ openssl

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY src ./src
COPY prisma/schema.prisma ./prisma/schema.prisma
COPY prisma/migrations ./prisma/migrations
COPY prisma.config.ts ./prisma.config.ts

# Generate Prisma client
RUN DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build npx prisma generate \
    && npm prune --omit=dev

ENV NODE_ENV=production

# Expose port
EXPOSE 5000

# Start command
CMD ["npm", "start"]
