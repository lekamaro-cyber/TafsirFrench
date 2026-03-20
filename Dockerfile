FROM node:20-alpine AS builder
WORKDIR /app
COPY site/package.json site/package-lock.json* ./site/
RUN cd site && npm install
COPY . .
RUN cd site && npm run build

FROM nginx:alpine
COPY --from=builder /app/site/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
