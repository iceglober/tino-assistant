/**
 * AWS persistence factory — re-exports createDynamoPersistence for use via
 * the @tino/aws/persistence export path.
 *
 * @tino/core dynamically imports this module when PERSISTENCE_ADAPTER=dynamodb,
 * keeping the AWS SDK out of core's bundle when using SQLite.
 */
export { createDynamoPersistence } from "./dynamo/index.js";
