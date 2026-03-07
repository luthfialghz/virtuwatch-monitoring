# Use official Node.js light image
FROM node:18-slim

# Create app directory
WORKDIR /usr/src/app

# Install system dependencies (ping utility is required by the 'ping' npm package)
RUN apt-get update && apt-get install -y iputils-ping && rm -rf /var/lib/apt/lists/*

# Install app dependencies
COPY package*.json ./
RUN npm install

# Bundle app source
COPY . .

# Environment variables will be handled by docker-compose or .env
# Running the script
CMD [ "node", "index.js" ]
