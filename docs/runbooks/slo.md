# xpelevator — SLO

## Targets

| Metric | Target |
|---|---|
| p99 latency | < 200ms |
| Error rate | < 0.1% |
| Availability | 99.9% |

## Error Budget

0.1% errors / 30 days = ~43 minutes downtime budget.
Sentry alert threshold: > 10 errors/hour triggers immediate response.
