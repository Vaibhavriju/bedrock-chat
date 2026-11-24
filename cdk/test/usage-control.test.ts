import { App, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { BUNDLING_STACKS } from 'aws-cdk-lib/cx-api';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { UserPool } from 'aws-cdk-lib/aws-cognito';
import { Database } from '../lib/constructs/database';
import { WebSocket } from '../lib/constructs/websocket';
import { Auth } from '../lib/constructs/auth';

function template() {
  const app = new App({ context: { [BUNDLING_STACKS]: [] } });
  const stack = new Stack(app, 'UsageTest', { env: { account: '123456789012', region: 'us-east-1' } });
  const database = new Database(stack, 'Database');
  const pool = new UserPool(stack, 'Users');
  const client = pool.addClient('Client');
  const large = new Bucket(stack, 'Large');
  const documents = new Bucket(stack, 'Documents');
  new WebSocket(stack, 'Socket', {
    database,
    auth: { userPool: pool, client } as unknown as Auth,
    bedrockRegion: 'us-east-1', largeMessageBucket: large, documentBucket: documents,
    globalAvailableModels: ['claude-v4.6-sonnet'],
    enableBedrockGlobalInference: true, enableBedrockCrossRegionInference: true,
    enableLambdaSnapStart: false,
  });
  return Template.fromStack(stack);
}

test('retains encrypted quota policies with point-in-time recovery and expiring counters', () => {
  const result = template();
  result.hasResource('AWS::DynamoDB::Table', {
    DeletionPolicy: 'Retain',
    UpdateReplacePolicy: 'Retain',
    Properties: Match.objectLike({
      BillingMode: 'PAY_PER_REQUEST',
      PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
      TimeToLiveSpecification: { AttributeName: 'ExpiresAt', Enabled: true },
      SSESpecification: { SSEEnabled: true },
    }),
  });
});

test('the private model probe uses the chat role and never gets a public invocation route', () => {
  const result = template();
  const functions = result.findResources('AWS::Lambda::Function');
  const probe = Object.entries(functions).find(([, value]) => String(value.Properties.Handler).includes('model_probe'))!;
  const chat = Object.values(functions).find((value) => String(value.Properties.Handler).includes('websocket'))!;
  expect(probe).toBeDefined();
  expect(probe[1].Properties.Role).toEqual(chat.Properties.Role);
  expect(chat.Properties.Environment.Variables.GLOBAL_AVAILABLE_MODELS).toBe('["claude-v4.6-sonnet"]');
  expect(probe[1].Properties.Environment.Variables.USAGE_CONTROL_TABLE_NAME).toEqual(chat.Properties.Environment.Variables.USAGE_CONTROL_TABLE_NAME);
  result.resourceCountIs('AWS::Lambda::Url', 0);
  const permissions = result.findResources('AWS::Lambda::Permission');
  expect(JSON.stringify(permissions)).not.toContain(probe[0]);
  result.hasOutput('FrontierModelProbeFunctionName', { Value: { Ref: probe[0] } });
});
