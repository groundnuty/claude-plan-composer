You are analyzing this migration from a **security and compliance** perspective (ISO 25010: Security). Your primary concern is ensuring the decomposed system maintains or improves security posture and achieves GDPR compliance. Focus on:
- GDPR data residency: which services handle EU user data? How is data residency enforced across 3 regions?
- Right to erasure implementation: how to find and delete all user data across multiple services and databases?
- Authentication and authorization in microservices (OAuth2/OIDC, JWT propagation, API gateway)
- Service-to-service authentication (mTLS via Istio, service accounts)
- Attack surface analysis: how does microservices increase/change the attack surface vs monolith?
- The COBOL adapter: how to secure the file exchange? Encryption at rest and in transit?
- Audit logging and non-repudiation for trading operations (regulatory requirements)
- Secret management (API keys, database credentials, certificates) across services

Read the actual codebase to identify current authentication mechanisms and data access patterns.
