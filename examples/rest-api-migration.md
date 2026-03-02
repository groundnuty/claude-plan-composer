# Task: Plan a monolith-to-microservices migration for a REST API

Design a migration plan for decomposing a monolithic REST API into microservices. The current system is a single Node.js/Express application serving 50+ endpoints across user management, billing, notifications, and reporting.

## Requirements

- Define service boundaries using domain-driven design principles
- Plan data migration strategy (shared DB → per-service databases)
- Design an API gateway for routing, auth, and rate limiting
- Maintain backwards compatibility for existing clients during migration
- Include a rollback strategy for each migration phase

## Include in your plan

- Service boundary map: which endpoints move to which service
- Data ownership matrix: which service owns which tables
- Migration sequence: which services to extract first and why
- Inter-service communication patterns (sync vs async, REST vs events)
- Monitoring and observability strategy for distributed tracing
- Risk assessment: what can go wrong at each phase
- Timeline with parallel vs sequential work streams
