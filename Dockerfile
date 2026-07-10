FROM node:20-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

# Chromium + OS deps cho Playwright (job "analyze" cần).
# Cài sau npm ci để browser revision khớp đúng version playwright trong lockfile.
RUN npx playwright install --with-deps chromium

COPY . .

# Toàn bộ lịch cron giữ nguyên theo UTC như GitHub Actions.
ENV TZ=UTC

# Container này là "runner" thường trực; Ofelia exec các job vào đây theo lịch.
CMD ["sleep", "infinity"]
