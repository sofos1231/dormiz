FROM node:20-slim

WORKDIR /app

RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

RUN npm install -g @expo/ngrok

COPY package*.json ./
RUN npm install

COPY . .

RUN chmod +x start.sh

EXPOSE 8081

CMD ["./start.sh"]
