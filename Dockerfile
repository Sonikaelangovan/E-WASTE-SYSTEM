FROM node:24-alpine
ENV NODE_ENV=production PORT=8092 DATA_DIR=/app/data
WORKDIR /app
COPY package.json ./
COPY server ./server
COPY public ./public
RUN mkdir -p /app/data && chown -R node:node /app
USER node
EXPOSE 8092
HEALTHCHECK --interval=20s --timeout=4s --start-period=15s --retries=3 CMD node -e "fetch('http://127.0.0.1:8092/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/app.js"]
