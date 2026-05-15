/**
 * @tino/aws — AWS-specific adapters and infrastructure for tino.
 *
 * - DynamoDB persistence adapters (imported dynamically by @tino/core)
 * - TinoService Pulumi component for deploying tino to AWS ECS
 */
export { createDynamoPersistence } from './persistence/factory.js';
export { TinoService, type TinoServiceArgs } from './pulumi/tino-service.js';
