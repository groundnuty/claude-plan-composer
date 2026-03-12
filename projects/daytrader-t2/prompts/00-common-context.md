# DayTrader 7 Monolith-to-Microservices Migration Plan

## System

Apache DayTrader 7 is a Java EE 7 benchmark application simulating an online stock trading system. It runs on OpenLiberty/WebSphere Liberty and uses a single relational database.

## Current Architecture

The monolith consists of 5 Maven modules sharing a single deployment unit:
- `daytrader-ee7-ejb` — business logic (EJBs), entity beans, trade operations
- `daytrader-ee7-web` — servlets, JSPs, REST endpoints
- `daytrader-ee7-wlpcfg` — Liberty server configuration
- `daytrader-ee7` — parent build module
- `sample.daytrader7` — root project

## Business Domains

Account management, portfolio tracking, stock quote retrieval, order processing (buy/sell), market simulation, benchmarking/load testing.

## Migration Goals

1. Decompose the monolith into independently deployable microservices
2. Enable independent scaling of high-traffic components (quote retrieval, order processing)
3. Improve fault isolation — a failure in order processing should not affect quote retrieval
4. Enable independent development and deployment cycles per service

## Constraints

These go beyond the standard DayTrader system and force genuine planning:

1. **Real-time streaming**: Market data must be streamed in real-time to 3 regional data centers (US-East, EU-West, APAC). Latency budget: <100ms for quote updates within a region.
2. **GDPR compliance**: EU user data (accounts, trading history) must reside in EU data centers. Right to erasure must be implementable across all services holding user data.
3. **Legacy integration**: A COBOL-based settlement system handles end-of-day trade settlement. It communicates via fixed-width file exchange on a batch schedule. An adapter layer must bridge this system.
4. **Zero-downtime migration**: The migration must be incremental (strangler fig pattern or equivalent). At no point should the trading platform be fully offline. Both monolith and microservices must coexist during the transition period.
5. **Target platform**: Kubernetes with Istio service mesh. All services must have health checks, circuit breakers, and distributed tracing (OpenTelemetry).

## Deliverable

A comprehensive migration plan covering service decomposition, data strategy, deployment approach, risk mitigation, and implementation sequencing.

## Instructions

You MUST explore the actual DayTrader codebase during plan generation. Read:
- Project structure (modules, packages)
- Key entity classes (`AccountDataBean`, `HoldingDataBean`, `OrderDataBean`, `QuoteDataBean`)
- EJB service layer (`TradeSLSBBean`, `TradeAction`)
- Web layer (servlets, JSPs)
- Database configuration and schema
- Build configuration (`pom.xml`)

Ground your recommendations in real class dependencies and data flows found in the code.
