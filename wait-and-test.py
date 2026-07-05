#!/usr/bin/env python3
import urllib.request
import json
import time
import sys

def check_build():
    try:
        r = json.loads(urllib.request.urlopen('https://api.github.com/repos/adrper79-dot/xpelevator/actions/runs?per_page=1').read())
        run = r['workflow_runs'][0]
        return run
    except Exception as e:
        print(f"Error fetching build status: {e}")
        return None

def test_endpoint():
    try:
        response = urllib.request.urlopen('https://xpelevator.com/api/debug/groq', timeout=10)
        data = json.loads(response.read())
        return data
    except Exception as e:
        return str(e)

print("Waiting for build to complete...")
for i in range(20):
    time.sleep(10)
    run = check_build()
    if run:
        sha = run['head_sha'][:7]
        status = run['status']
        conclusion = run['conclusion']
        print(f"[{i*10}s] {sha} - {status} - {conclusion}")
        
        if sha == '93bc093' and status == 'completed':
            print(f"\n✓ Build completed with conclusion: {conclusion}")
            if conclusion == 'success':
                # Wait a bit for CDN
                print("Waiting 15s for CDN propagation...")
                time.sleep(15)
                
                print("\nTesting endpoint...")
                result = test_endpoint()
                if isinstance(result, dict):
                    print(f"Success: {result.get('success')}")
                    if result.get('success'):
                        print(f"Response: {result.get('response', '')[:150]}")
                    else:
                        print(f"Error: {result.get('error', {}).get('message', 'Unknown')}")
                else:
                    print(f"Request error: {result}")
            break

print("\nDone.")
