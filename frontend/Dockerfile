FROM node:20-slim

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install

COPY . .

ENV NEXT_PUBLIC_BACKEND_URL=http://127.0.0.1:8000
EXPOSE 3000
CMD ["npm", "run", "dev"]
