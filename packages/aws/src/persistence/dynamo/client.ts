import http from "node:http";
import { CreateTableCommand, DescribeTableCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { Table } from "dynamodb-toolbox";

/**
 * Creates a DynamoDB Toolbox Table bound to the given table name.
 *
 * When `endpoint` is provided (e.g., `http://127.0.0.1:8000` for DynamoDB
 * Local), the client connects there instead of AWS. The table is auto-created
 * if it doesn't exist.
 *
 * Uses a custom NodeHttpHandler with an explicit http.Agent that forces IPv4
 * connections. AWS SDK v3 on Node 24 hangs when connecting to localhost/127.0.0.1
 * without this — the default agent's connection pooling interacts badly with
 * Node 24's HTTP internals.
 */
export async function createDynamoTable(tableName: string, endpoint?: string): Promise<TinoTable> {
  const clientConfig: ConstructorParameters<typeof DynamoDBClient>[0] = {};

  if (endpoint) {
    clientConfig.endpoint = endpoint;
    clientConfig.credentials = { accessKeyId: "local", secretAccessKey: "local" };
    clientConfig.region = "us-east-1";

    // Force a fresh http.Agent with keepAlive disabled to avoid connection
    // pooling issues on Node 24.
    const agent = new http.Agent({ keepAlive: false, family: 4 });
    clientConfig.requestHandler = new NodeHttpHandler({
      httpAgent: agent,
      connectionTimeout: 3000,
      socketTimeout: 3000,
    });
  }

  const client = new DynamoDBClient(clientConfig);
  const documentClient = DynamoDBDocumentClient.from(client);

  // Auto-create table in local mode
  if (endpoint) {
    try {
      await client.send(new DescribeTableCommand({ TableName: tableName }));
    } catch (err: unknown) {
      if ((err as { name?: string }).name === "ResourceNotFoundException") {
        await client.send(
          new CreateTableCommand({
            TableName: tableName,
            KeySchema: [
              { AttributeName: "pk", KeyType: "HASH" },
              { AttributeName: "sk", KeyType: "RANGE" },
            ],
            AttributeDefinitions: [
              { AttributeName: "pk", AttributeType: "S" },
              { AttributeName: "sk", AttributeType: "S" },
              { AttributeName: "gsi1pk", AttributeType: "S" },
              { AttributeName: "gsi1sk", AttributeType: "S" },
            ],
            GlobalSecondaryIndexes: [
              {
                IndexName: "gsi1",
                KeySchema: [
                  { AttributeName: "gsi1pk", KeyType: "HASH" },
                  { AttributeName: "gsi1sk", KeyType: "RANGE" },
                ],
                Projection: { ProjectionType: "ALL" },
                ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
              },
            ],
            BillingMode: "PAY_PER_REQUEST",
          }),
        );
      } else {
        throw err;
      }
    }
  }

  return new Table({
    name: tableName,
    partitionKey: { name: "pk", type: "string" },
    sortKey: { name: "sk", type: "string" },
    indexes: {
      gsi1: {
        type: "global",
        partitionKey: { name: "gsi1pk", type: "string" },
        sortKey: { name: "gsi1sk", type: "string" },
      },
    },
    documentClient,
  });
}

export type TinoTable = Table<
  { name: "pk"; type: "string" },
  { name: "sk"; type: "string" },
  {
    gsi1: {
      type: "global";
      partitionKey: { name: "gsi1pk"; type: "string" };
      sortKey: { name: "gsi1sk"; type: "string" };
    };
  }
>;
