#!/usr/bin/env bash
set -euo pipefail

# Configuration
REGION="${AWS_REGION:-us-east-1}"
STACK_NAME="TinoStack"

echo "=== Reading stack outputs ==="
ECR_REPO=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='EcrRepoUri'].OutputValue" \
  --output text \
  --region "$REGION")

CLUSTER=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='ClusterName'].OutputValue" \
  --output text \
  --region "$REGION")

SERVICE=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='ServiceName'].OutputValue" \
  --output text \
  --region "$REGION")

echo "  ECR:     $ECR_REPO"
echo "  Cluster: $CLUSTER"
echo "  Service: $SERVICE"

echo ""
echo "=== Building Docker image ==="
docker build -t tino:latest .

echo ""
echo "=== Tagging and pushing to ECR ==="
aws ecr get-login-password --region "$REGION" \
  | docker login --username AWS --password-stdin "$ECR_REPO"
docker tag tino:latest "${ECR_REPO}:latest"
docker push "${ECR_REPO}:latest"

echo ""
echo "=== Forcing new ECS deployment ==="
aws ecs update-service \
  --cluster "$CLUSTER" \
  --service "$SERVICE" \
  --force-new-deployment \
  --region "$REGION" \
  --no-cli-pager

echo ""
echo "=== Done. New task will start in ~30s ==="
echo "Watch logs: aws logs tail /ecs/tino --follow --region $REGION"
