# Stage 1: Builder
FROM node:22-bookworm AS builder

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install dependencies (including dev deps for building)
RUN pnpm install --frozen-lockfile

# Copy source code
COPY tsconfig.json ./
COPY src ./src

# Build TypeScript
RUN pnpm run build

# Pre-download the model during build (optional - speeds up container startup)
RUN node -e "import('@xenova/transformers').then(m => m.pipeline('token-classification', 'aaronaco/piiranha-v1-onnx', {quantized: true})).then(() => console.log('[OK] Model downloaded'))" || echo "[WARN] Model pre-download skipped"

# Prune dev dependencies
RUN pnpm prune --prod

# Stage 2: Production Runtime
FROM gcr.io/distroless/nodejs22-debian12

WORKDIR /app

# Copy built application
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# Copy HuggingFace cache if model was pre-downloaded
COPY --from=builder /root/.cache/huggingface /root/.cache/huggingface

# Set environment
ENV NODE_ENV=production

# Expose port
EXPOSE 3000

# Run application
CMD ["dist/index.js"]
