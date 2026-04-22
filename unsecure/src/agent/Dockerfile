FROM mcr.microsoft.com/devcontainers/python:1-3.12-bookworm

WORKDIR /app

RUN mkdir -p /workspace

COPY ./ .

RUN pip install --no-cache-dir -r requirements.txt

EXPOSE 8088

CMD ["python", "main.py"]
