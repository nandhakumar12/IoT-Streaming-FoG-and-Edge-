FROM python:3.11-slim

WORKDIR /app

# Install dependencies
RUN pip install --no-cache-dir scikit-learn numpy

COPY detector.py .

ENV ANOMALY_PORT=5001
ENV ANOMALY_TRAIN_MIN=30
ENV ANOMALY_WINDOW=200
ENV ANOMALY_THRESHOLD=-0.1

EXPOSE 5001

CMD ["python", "detector.py"]
