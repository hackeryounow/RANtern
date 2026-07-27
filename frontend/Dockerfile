# ── Stage 1: Build React app ──
FROM node:20-alpine AS builder

WORKDIR /app

ARG VITE_API_URL=
ARG VITE_WS_URL=
ARG VITE_SIP_WS_URL=
ARG VITE_SIP_URI=
ARG VITE_SIP_PASSWORD=

ENV VITE_API_URL=$VITE_API_URL \
    VITE_WS_URL=$VITE_WS_URL \
    VITE_SIP_WS_URL=$VITE_SIP_WS_URL \
    VITE_SIP_URI=$VITE_SIP_URI \
    VITE_SIP_PASSWORD=$VITE_SIP_PASSWORD

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# ── Stage 2: Serve with Nginx ──
FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80 443

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
