import { DynamoDBClient, CreateTableCommand, DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { Table } from 'dynamodb-toolbox';

/**
 * Creates a DynamoDB Toolbox Table bound to the given table name.
 *
 * When `endpoint` is provided (e.g., `http://localhost:8000` for DynamoDB
 * Local), the client connects there instead of AWS. The table is auto-created
 * if it doesn't exist — this makes local dev zero-setup beyond starting the
 * DynamoDB Local container.
 *
 * In production (no endpoint override), the table must already exist (created
 * by CDK). Auto-creation is skipped.
 */
export async function createDynamoTable(
  tableName: string,
  endpoint?: string,
): Promise<TinoTable> {
  const client = new DynamoDBClient(endpoint ? {
    endpoint,
    // DynamoDB Local requires credentials but doesn't validate them.
    // Provide dummy values so the SDK doesn't hang trying to resolve
    // real credentials from IMDS/ECS/SSO.
    credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
    region: 'us-east-1',
  } : {});
  const documentClient = DynamoDBDocumentClient.from(client);

  // Auto-create table in local mode
  if (endpoint) {
    try {
      await client.send(new DescribeTableCommand({ TableName: tableName }));
    } catch (err: unknown) {
      if ((err as { name?: string }).name === 'ResourceNotFoundException') {
        await client.send(new CreateTableCommand({
          TableName: tableName,
          KeySchema: [
            { AttributeName: 'pk', KeyType: 'HASH' },
            { AttributeName: 'sk', KeyType: 'RANGE' },
          ],
          AttributeDefinitions: [
            { AttributeName: 'pk', AttributeType: 'S' },
            { AttributeName: 'sk', AttributeType: 'S' },
            { AttributeName: 'gsi1pk', AttributeType: 'S' },
            { AttributeName: 'gsi1sk', AttributeType: 'S' },
          ],
          GlobalSecondaryIndexes: [
            {
              IndexName: 'gsi1',
              KeySchema: [
                { AttributeName: 'gsi1pk', KeyType: 'HASH' },
                { AttributeName: 'gsi1sk', KeyType: 'RANGE' },
              ],
              Projection: { ProjectionType: 'ALL' },
              ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
            },
          ],
          BillingMode: 'PAY_PER_REQUEST',
        }));
      } else {
        throw err;
      }
    }
  }

  return new Table({
    name: tableName,
    partitionKey: { name: 'pk', type: 'string' },
    sortKey: { name: 'sk', type: 'string' },
    indexes: {
      gsi1: {
        type: 'global',
        partitionKey: { name: 'gsi1pk', type: 'string' },
        sortKey: { name: 'gsi1sk', type: 'string' },
      },
    },
    documentClient,
  });
}

export type TinoTable = Table<
  { name: 'pk'; type: 'string' },
  { name: 'sk'; type: 'string' },
  {
    gsi1: {
      type: 'global';
      partitionKey: { name: 'gsi1pk'; type: 'string' };
      sortKey: { name: 'gsi1sk'; type: 'string' };
    };
  }
>;
