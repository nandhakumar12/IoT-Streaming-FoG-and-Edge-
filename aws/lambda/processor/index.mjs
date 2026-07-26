/**
 * AWS Lambda – SQS Processor
 * ─────────────────────────────────────────────────────────────────────────────
 * Triggered by SQS when the fog node dispatches an aggregated payload.
 * Writes processed sensor data to DynamoDB for persistence.
 *
 * Design:
 *   - SQS trigger with BatchSize=10 allows processing up to 10 messages
 *     per Lambda invocation, reducing cold-start overhead
 *   - DynamoDB single-table design:
 *       PK: sensorType (e.g. "temperature")
 *       SK: timestamp  (ISO 8601 UTC, enables time-range queries)
 *   - On parse failure, message is sent to SQS Dead Letter Queue (DLQ)
 *     rather than poisoning the entire batch (partial batch failure)
 *
 * Scalability argument for the report:
 *   "The SQS → Lambda architecture decouples data ingestion from processing.
 *    During fog node burst events, SQS queues messages and Lambda scales
 *    horizontally up to 1,000 concurrent instances without manual provisioning
 *    [AWS Lambda documentation, 2024]. This serverless pattern eliminates
 *    the need for fixed-capacity EC2 fleet management."
 *
 * Reference: AWS Well-Architected Framework – Reliability Pillar (2023)
 */

import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';

const dynamo = new DynamoDBClient({ region: process.env.AWS_REGION || 'eu-west-1' });
const TABLE_NAME = process.env.DYNAMODB_TABLE || 'EdgeGuardianReadings';

/**
 * Lambda handler — processes SQS event batch.
 *
 * @param {object} event - SQS event with Records array
 * @returns {{ batchItemFailures: Array }} - Failed message IDs for DLQ routing
 */
export const handler = async (event) => {
  const batchItemFailures = [];

  for (const record of event.Records) {
    try {
      const payload = JSON.parse(record.body);

      // Build DynamoDB item
      const item = {
        // Primary key: enables query by sensor type
        sensorType:     payload.type,
        // Sort key: enables time-range queries with GSI
        timestamp:      payload.flushed_at || payload.timestamp || new Date().toISOString(),
        // Data fields
        sensorIds:      payload.sensor_ids || [payload.sensor_id],
        meanValue:      payload.mean ?? payload.value,
        minValue:       payload.min,
        maxValue:       payload.max,
        stdDev:         payload.std_dev,
        count:          payload.count ?? 1,
        unit:           payload.unit,
        priority:       payload.priority || 'INFO',
        alertMessage:   payload.alert_message || null,
        windowMs:       payload.window_ms,
        isBypass:       payload._bypass || false,
        // TTL: auto-delete records after 7 days (DynamoDB TTL)
        ttl:            Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60),
        // Ingestion timestamp (for latency measurement)
        ingestedAt:     new Date().toISOString(),
      };

      // Remove undefined values (DynamoDB rejects them)
      const cleanItem = Object.fromEntries(
        Object.entries(item).filter(([, v]) => v !== undefined && v !== null)
      );

      await dynamo.send(new PutItemCommand({
        TableName: TABLE_NAME,
        Item: marshall(cleanItem, { removeUndefinedValues: true }),
      }));

      console.log(`[Processor] Stored: ${payload.type} | priority=${payload.priority}`);

    } catch (err) {
      console.error(`[Processor] Failed to process record ${record.messageId}:`, err);
      // Report failure for this specific message — SQS will retry it
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
};
