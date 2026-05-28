<!-- GENERATED FILE. Do not edit directly. Run npm run docs:diagrams. -->

---
status: generated
owner: platform
doc_type: diagram
fidelity: generated
title: "Factory Workflow Map"
generator: npm run docs:diagrams
last_generated: 2026-05-28
source:
  - .github/workflows/*.yml
  - .github/workflows/REGISTRY.md
---

# Factory Workflow Map

```mermaid
flowchart TB
  Other["Other"]
  Quality["Quality"]
  Other --> ci_yml["ci.yml"]
  Other --> deploy_yml["deploy.yml"]
  Quality --> docs_health_yml["docs-health.yml"]
```
