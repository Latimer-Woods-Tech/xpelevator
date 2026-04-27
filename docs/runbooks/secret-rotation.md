# xpelevator — Secret Rotation

| Secret | Rotate Every | Command |
|---|---|---|
| JWT_SECRET | 90 days | `wrangler secret put JWT_SECRET --name xpelevator` |
| SENTRY_DSN | Never (on compromise) | `wrangler secret put SENTRY_DSN --name xpelevator` |
| POSTHOG_KEY | Never (on compromise) | `wrangler secret put POSTHOG_KEY --name xpelevator` |
