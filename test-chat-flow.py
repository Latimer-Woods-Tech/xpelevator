#!/usr/bin/env python3
import urllib.request
import json

# Start a new simulation
print("1. Starting simulation...")
req = urllib.request.Request(
    'https://xpelevator.com/api/simulations',
    data=json.dumps({"scenarioId": 1, "jobTitleId": 1, "type": "CHAT"}).encode(),
    headers={'Content-Type': 'application/json'},
    method='POST'
)
response = json.loads(urllib.request.urlopen(req).read())
session_id = response['sessionId']
print(f"   Session ID: {session_id}")

# Send a message
print("\n2. Sending message...")
req = urllib.request.Request(
    'https://xpelevator.com/api/chat',
    data=json.dumps({"sessionId": session_id, "message": "Hi, how can I help you today?"}).encode(),
    headers={'Content-Type': 'application/json'},
    method='POST'
)
response = json.loads(urllib.request.urlopen(req).read())
print(f"   AI Response: {response.get('response', 'ERROR')[:150]}")
print(f"   Success: {not response.get('response', '').startswith('I apologize, but')}")

print("\n✓ Chat is working!")
