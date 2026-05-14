#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { TinoStack } from './tino-stack.js';

const app = new cdk.App();
new TinoStack(app, 'TinoStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
  },
});
