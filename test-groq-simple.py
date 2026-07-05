#!/usr/bin/env python3
import urllib.request
import json
import sys

try:
    print("Testing https://xpelevator.com/api/debug/groq ...", file=sys.stderr)
    req = urllib.request.Request('https://xpelevator.com/api/debug/groq')
    with urllib.request.urlopen(req, timeout=10) as response:
        data = json.loads(response.read())
        print(json.dumps(data, indent=2))
except Exception as e:
    print(f"Error: {e}", file=sys.stderr)
    sys.exit(1)
