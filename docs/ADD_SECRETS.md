# Adding Production Secrets (GitHub Actions)

This short guide shows how to add the runtime secrets the deployment workflow needs.

Required secret names (add these under Settings → Secrets → Actions):

- `GROQ_API_KEY`
- `DATABASE_URL`
- `AUTH_SECRET`
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Notes
- Do NOT paste secret values into issues, PRs, or chat.
- The repository workflow will run `wrangler pages secret put` during deploy to add these secrets to Cloudflare Pages.
- If you'd rather set secrets directly in the Cloudflare Pages dashboard, you can — the deployment workflow will use whatever is present in Pages at deploy time.

CLI example (requires GitHub CLI `gh` and appropriate permission):

```bash
gh secret set GROQ_API_KEY --repo adrper79-dot/xpelevator
gh secret set DATABASE_URL --repo adrper79-dot/xpelevator
gh secret set AUTH_SECRET --repo adrper79-dot/xpelevator
gh secret set CLOUDFLARE_API_TOKEN --repo adrper79-dot/xpelevator
gh secret set CLOUDFLARE_ACCOUNT_ID --repo adrper79-dot/xpelevator
```

If you want me to run the `gh` commands from this environment, I can do so after you authenticate the GitHub CLI here or provide a deploy API token with the minimal required scopes (secrets write for repo and secrets read for workflow), but do NOT paste tokens in chat.
