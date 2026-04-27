# xpelevator — Database

## Generate Migration

```bash
npx drizzle-kit generate
```

## Apply Migration

```bash
export DATABASE_URL="postgresql://..."
npx drizzle-kit migrate
```

## Preview Branch (CI)

Set NEON_PREVIEW_URL in GitHub repo secrets to run migration dry-run in CI.
