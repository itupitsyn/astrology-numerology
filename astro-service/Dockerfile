# --- builder: compile deps (pyswisseph et al.) into an isolated venv ---
FROM python:3.11-slim AS builder

WORKDIR /app

# Build tools needed only to compile wheels — kept out of the final image.
RUN apt-get update \
    && apt-get install -y --no-install-recommends gcc build-essential \
    && rm -rf /var/lib/apt/lists/*

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# --- runtime: slim image with just the venv + app, no compilers ---
FROM python:3.11-slim AS runtime

WORKDIR /app

# Bring over the prebuilt venv only — no gcc/build-essential in the final image.
COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY . .

EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
