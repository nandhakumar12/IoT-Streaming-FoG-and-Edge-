/**
 * AWS Lambda – Ingest Function
 * Receives POST from fog node, validates, and enqueues to SQS.
 * Acts as API Gateway proxy → SQS bridge.
 */
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

const sqs = new SQSClient({ region: process.env.AWS_REGION || 'eu-west-1' });
const QUEUE_URL = process.env.SQS_QUEUE_URL;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Content-Type': 'application/json',
};

export const handler = async (event) => {
  if (event.requestContext?.http?.method === 'OPTIONS' || event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  if (!payload.type) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Missing: type' }) };
  }

  try {
    await sqs.send(new SendMessageCommand({
      QueueUrl:    QUEUE_URL,
      MessageBody: JSON.stringify(payload),
      MessageAttributes: {
        sensorType: { DataType: 'String', StringValue: payload.type },
        priority:   { DataType: 'String', StringValue: payload.priority || 'INFO' },
      },
    }));

    return { statusCode: 202, headers: CORS_HEADERS, body: JSON.stringify({ status: 'queued' }) };
  } catch (err) {
    console.error('[Ingest] SQS error:', err);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: err.message }) };
  }
};
