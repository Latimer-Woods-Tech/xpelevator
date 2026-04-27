# xpelevator — Deployment

## Staging

```bash
wrangler deploy --env staging
curl https://staging.xpelevator.workers.dev/health
```

## Production

```bash
wrangler deploy
```

## Rollback

```bash
wrangler rollback
```
