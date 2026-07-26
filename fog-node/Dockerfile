FROM node:20-alpine

WORKDIR /app

# Install dependencies first (cached layer)
COPY package.json .
RUN npm install --omit=dev

# Copy source
COPY src/ ./src/

# Expose metrics API port
EXPOSE 3001

CMD ["node", "src/index.js"]
