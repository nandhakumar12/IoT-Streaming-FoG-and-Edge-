# EdgeGuardian: Fog & Edge Computing MQTT/Kafka Stream Processor
An intelligent Fog Computing architecture built for NCI H9FECC IoT coursework.

## 🏗️ Architecture
- **Sensors (Python)**: Virtual sensors publishing to Mosquitto MQTT.
- **Fog Node (Node.js)**: Consumes MQTT, performs aggregation, schema validation, and routes to AI.
- **Anomaly Detection (Python)**: Isolation Forest AI microservice for scoring readings.
- **Message Broker (Kafka)**: High-throughput queue separating fog from cloud backend.
- **Backend (Node.js)**: Consumes from Kafka. Stores in local SQLite for speed, caches in Redis, and asynchronously fans-out to AWS API Gateway → DynamoDB.
- **Dashboard (React)**: Real-time UI to monitor the pipeline.

## 🚀 How to Run on AWS EC2 (or local Docker)

1. **Clone the repository**
   ```bash
   git clone https://github.com/nandhakumar12/IoT-Streaming-FoG-and-Edge-.git
   cd IoT-Streaming-FoG-and-Edge-
   ```

2. **Start the stack**
   We use Docker Compose to orchestrate all 8 microservices (Mosquitto, Kafka, Zookeeper, Redis, Fog Node, Backend, AI Anomaly, Sensors, Dashboard).
   ```bash
   cd docker
   docker compose up -d
   ```

3. **Access the Dashboard**
   - If running locally: [http://localhost:5173](http://localhost:5173)
   - If running on AWS EC2: Ensure ports `5173`, `3000`, and `3001` are open in your EC2 Security Group. Access via `http://<YOUR-EC2-PUBLIC-IP>:5173`.
   
   *Note: If running on EC2, you must update the dashboard's `.env` or `VITE_API_BASE_URL` in `docker-compose.yml` to point to your EC2 public IP instead of localhost!*

## ☁️ AWS Cloud Integration
The local backend automatically mirrors all Kafka messages to a deployed AWS Serverless stack:
- **API Gateway**: REST endpoint `/ingest`
- **SQS**: Decoupled queue for high traffic spikes
- **Lambda**: Node.js workers processing the SQS queue
- **DynamoDB**: Persistent NoSQL storage
