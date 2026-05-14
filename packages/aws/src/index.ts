/**
 * @tino/aws — AWS-specific adapters and infrastructure for tino.
 *
 * - DynamoDB persistence adapters (imported dynamically by @tino/core)
 * - CDK stack for deploying tino to AWS ECS
 */
export { createDynamoPersistence } from './persistence/factory.js';
