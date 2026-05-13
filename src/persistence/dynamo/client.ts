import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { Table } from 'dynamodb-toolbox';

/**
 * Creates a DynamoDB Toolbox Table bound to the given table name.
 *
 * Uses the AWS SDK default credential chain (same as Bedrock/CloudWatch).
 * AWS_REGION env var is optional — the SDK resolves it from ~/.aws/config or
 * AWS_DEFAULT_REGION if not set.
 */
export function createDynamoTable(tableName: string): Table<
  { name: 'pk'; type: 'string' },
  { name: 'sk'; type: 'string' },
  {
    gsi1: {
      type: 'global';
      partitionKey: { name: 'gsi1pk'; type: 'string' };
      sortKey: { name: 'gsi1sk'; type: 'string' };
    };
  }
> {
  const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

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

export type TinoTable = ReturnType<typeof createDynamoTable>;
