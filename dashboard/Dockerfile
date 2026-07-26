FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Expose Vite's default port
EXPOSE 5173

# Run Vite in host mode so it's accessible from outside the container
CMD ["npm", "run", "dev", "--", "--host"]
