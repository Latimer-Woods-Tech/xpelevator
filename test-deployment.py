#!/usr/bin/env python3
import urllib.request
import json
import time

# Check deployment status
r = json.loads(urllib.request.urlopen('https://api.github.com/repos/adrper79-dot/xpelevator/actions/runs?per_page=2').read())
runs = r['workflow_runs'][:2]

for run in runs:
    print(f"\nCommit: {run['head_commit']['message'][:70]}")
    print(f"SHA: {run['head_sha'][:7]}")
    print(f"Status: {run['status']}")
    print(f"Conclusion: {run['conclusion']}")
    print(f"Created: {run['created_at']}")

print("\n--- Testing Groq endpoint ---")
try:
    response = urllib.request.urlopen('https://xpelevator.com/api/debug/groq')
    data = json.loads(response.read())
    print(f"Success: {data.get('success')}")
    if data.get('success'):
        print(f"Response: {data.get('response', '')[:100]}")
    else:
        print(f"Error: {data.get('error', {}).get('message', 'Unknown')}")
except Exception as e:
    print(f"Request failed: {e}")
