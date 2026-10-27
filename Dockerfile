# Use official Node.js image
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files and install dependencies
COPY package.json package-lock.json* ./
RUN npm ci

# Copy the rest of the app
COPY . .

# Build the Next.js app and prepare writable log dir
RUN npm run build && npm prune --omit=dev && mkdir -p /app/logs && chown -R node:node /app

USER node

# Expose the port the app runs on
EXPOSE 3000

# Start the app
CMD ["npm", "start"]
