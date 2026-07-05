#!/usr/bin/env python3
import urllib.request
import json

print("Checking build status...")
try:
    r = json.loads(urllib.request.urlopen('https://api.github.com/repos/adrper79-dot/xpelevator/actions/runs?per_page=1', timeout=5).read())
    run = r['workflow_runs'][0]
    print(f"SHA: {run['head_sha'][:7]}")
    print(f"Message: {run['head_commit']['message'][:70]}")
    print(f"Status: {run['status']}")
    print(f"Conclusion: {run['conclusion'] or 'in progress'}")
except Exception as e:
    print(f"Error: {e}")
