#!/usr/bin/env python3
import urllib.request
import json

r = json.loads(urllib.request.urlopen('https://api.github.com/repos/adrper79-dot/xpelevator/actions/runs?per_page=2').read())
for run in r['workflow_runs'][:2]:
    print(f"\nSHA: {run['head_sha'][:7]}")
    print(f"Message: {run['head_commit']['message']}")
    print(f"Status: {run['status']}")
    print(f"Conclusion: {run['conclusion'] or 'in progress'}")
    print(f"URL: {run['html_url']}")
