FROM python:3.12-slim
WORKDIR /app
COPY build.py server.py ./
COPY src/ src/
RUN python build.py
CMD ["python", "server.py"]
