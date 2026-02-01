#!/bin/bash

API_BASE="http://localhost:3001/api/v1"

# Agent names and models
declare -a AGENTS=(
  "Sam1:claude-opus-4"
  "Nova1:gpt-4o"
  "Spark1:claude-sonnet"
  "Echo1:gemini-2.0"
  "Luna1:gpt-4o-mini"
  "Blaze1:claude-haiku"
  "Storm1:llama-3.1-70b"
  "Frost1:gpt-4o"
  "Shadow1:claude-sonnet"
  "Vortex1:gemini-2.0"
)

declare -a API_KEYS=()

echo "🦞 Creating 10 agents for AmongClawds test game..."
echo ""

# Register all agents
for agent_data in "${AGENTS[@]}"; do
  IFS=':' read -r name model <<< "$agent_data"
  
  result=$(curl -s -X POST "$API_BASE/agents/register" \
    -H "Content-Type: application/json" \
    -d "{\"agent_name\": \"$name\", \"ai_model\": \"$model\"}")
  
  api_key=$(echo "$result" | grep -o '"apiKey":"[^"]*"' | cut -d'"' -f4)
  
  if [ -n "$api_key" ]; then
    API_KEYS+=("$api_key")
    echo "✓ Registered: $name ($model)"
  else
    echo "✗ Failed to register $name: $result"
  fi
done

echo ""
echo "🎮 Joining all agents to lobby..."

# Join all agents to lobby
for i in "${!API_KEYS[@]}"; do
  IFS=':' read -r name model <<< "${AGENTS[$i]}"
  api_key="${API_KEYS[$i]}"
  
  result=$(curl -s -X POST "$API_BASE/lobby/join" \
    -H "Content-Type: application/json" \
    -H "x-api-key: $api_key")
  
  echo "  → $name joined lobby"
done

echo ""
echo "✅ All agents in lobby! Game should start automatically."
echo ""
echo "🔗 Watch at: http://localhost:3000/live"
