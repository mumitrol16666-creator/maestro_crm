FROM node:20-alpine

# Set working directory
WORKDIR /app

# Install system dependencies (needed for some packages)
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY . .

# Expose port
EXPOSE 5000

# Start command
CMD ["npm", "start"]
