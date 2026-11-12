# Production Dockerfile for JSON Explorer Telegram Bot
FROM python:3.12-slim

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    STORAGE_DIR=/data \
    PORT=8080

# Install system dependencies (build-essential and libyajl for high-performance ijson C backend)
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libyajl-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy dependency definition
COPY requirements.txt .

# Install python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy bot source code
COPY bot/ /app/bot/

# Create persistent storage directory
RUN mkdir -p /data/uploads /data/chunks /data/zips

# Expose HTTP port for direct large file uploads & downloads
EXPOSE 8080

# Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

# Start the bot application
CMD ["python", "-m", "bot.main"]
