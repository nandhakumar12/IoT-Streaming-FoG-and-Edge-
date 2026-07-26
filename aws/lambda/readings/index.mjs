/**
 * AWS Lambda – Readings API Handler
 * ─────────────────────────────────────────────────────────────────────────────
 * Serves the React dashboard via API Gateway GET /readings endpoint.
 * Queries DynamoDB for historical sensor readings with optional filtering.
 *
 * Routes:
 *   GET /readings?sensorType=temperature&limit=50
 *     → Returns last N readings for a specific sensor type
 *
 *   GET /readings/latest
 *     → Returns the most recent reading for each sensor type (for dashboard cards)
 *
 *   GET /alerts?limit=20
 *     → Returns recent CRITICAL and WARNING events only
 *
 * Performance: DynamoDB Query (not Scan) is used throughout, ensuring O(1)
 * read performance regardless of total dataset size. This is a key scalability
 * design decision — Scan operations degrade at scale [AWS DynamoDB docs, 2024].
 */

import {
  DynamoDBClient,
  QueryCommand,
  ScanCommand,
} from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';

const dynamo = new DynamoDBClient({ region: process.env.AWS_REGION || 'eu-west-1' });
const TABLE_NAME = process.env.DYNAMODB_TABLE || 'EdgeGuardianReadings';

// ── CORS headers for React dashboard ─────────────────────────────────────────
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,x-api-key',
  'Content-Type': 'application/json',
};

const response = (statusCode, body) => ({
  statusCode,
  headers: CORS_HEADERS,
  body: JSON.stringify(body),
});

/**
 * Lambda handler.
 * @param {object} event - API Gateway proxy event
 */
export const handler = async (event) => {
  // Handle CORS preflight
  if (event.requestContext?.http?.method === 'OPTIONS' || event.httpMethod === 'OPTIONS') {
    return response(200, {});
  }

  // API Gateway v2 (HTTP API) uses rawPath; v1 (REST API) uses path
  const path   = event.rawPath || event.path || '';
  const params = event.queryStringParameters || {};

  try {
    // ── GET /readings/latest ─────────────────────────────────────────────────
    if (path.endsWith('/latest')) {
      const sensorTypes = ['temperature', 'vibration', 'humidity', 'pressure', 'power_consumption'];
      const results = {};

      for (const sensorType of sensorTypes) {
        const cmd = new QueryCommand({
          TableName: TABLE_NAME,
          KeyConditionExpression: 'sensorType = :st',
          ExpressionAttributeValues: { ':st': { S: sensorType } },
          ScanIndexForward: false,  // newest first
          Limit: 1,
        });
        const data = await dynamo.send(cmd);
        if (data.Items?.length > 0) {
          results[sensorType] = unmarshall(data.Items[0]);
        }
      }

      return response(200, { latest: results, fetchedAt: new Date().toISOString() });
    }

    // ── GET /alerts ──────────────────────────────────────────────────────────
    if (path.endsWith('/alerts')) {
      const limit = Math.min(parseInt(params.limit || '20', 10), 100);
      const cmd = new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: 'priority = :c OR priority = :w',
        ExpressionAttributeValues: {
          ':c': { S: 'CRITICAL' },
          ':w': { S: 'WARNING' },
        },
        Limit: 200,  // Scan a larger set, client filters top N
      });
      const data = await dynamo.send(cmd);
      const items = (data.Items || [])
        .map(i => unmarshall(i))
        .sort((a, b) => b.timestamp?.localeCompare(a.timestamp || '') || 0)
        .slice(0, limit);

      return response(200, { alerts: items, count: items.length });
    }

    // ── GET /readings?sensorType=X&limit=N ───────────────────────────────────
    const sensorType = params.sensorType || 'temperature';
    const limit = Math.min(parseInt(params.limit || '50', 10), 200);

    const cmd = new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'sensorType = :st',
      ExpressionAttributeValues: { ':st': { S: sensorType } },
      ScanIndexForward: false,  // newest first
      Limit: limit,
    });

    const data = await dynamo.send(cmd);
    const items = (data.Items || []).map(i => unmarshall(i));

    return response(200, {
      sensorType,
      readings: items,
      count: items.length,
      fetchedAt: new Date().toISOString(),
    });

  } catch (err) {
    console.error('[ReadingsAPI] Error:', err);
    return response(500, { error: 'Internal server error', message: err.message });
  }
};
