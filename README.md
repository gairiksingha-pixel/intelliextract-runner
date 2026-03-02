# IntelliExtract Runner

**A Professional, High-Performance Extraction Orchestrator & Dashboard**

IntelliExtract Runner is a high-performance TypeScript application designed to orchestrate large-scale data extraction from the IntelliExtract Spreadsheet API. Built on **Clean Architecture** principles, it provides a robust CLI and a stunning Web Dashboard for managing S3 synchronization, batch extraction, scheduling, and analytics.

---

## 🏗️ Architecture & Design Principles

This project is built to enterprise standards for maintainability and scalability:

- **Clean Architecture**: Strict separation of concerns between Domain, Use Case, Adapter, and Infrastructure layers.
- **SOLID Principles**: Focused repositories, dependency inversion via interfaces, and single-responsibility services.
- **High-Grade Type Safety**: Strict TypeScript implementation with minimal `any` usage, ensuring robust contracts between layers.
- **SQL-Based Persistence**: Powered by SQLite for high-concurrency, ACID-compliant storage of extraction records, sync manifests, and schedules.

---

## ✨ Key Features

- **🚀 Triple-Mode Execution**:
  - **Sync**: Pull files from S3 with SHA-256 integrity checks.
  - **Run**: Batch extract local staging files with aggressive RPS and concurrency controls.
  - **Pipeline (sync-extract)**: Seamlessly sync and extract files in a high-throughput stream.
- **📊 Real-time Dashboard**: A premium, glassmorphism-inspired Web UI with real-time progress bars, performance charts, and historical run analytics.
- **⏰ Smart Scheduler**: Built-in cron manager with persistent storage. Schedule individual tenant/purchaser jobs with custom frequencies.
- **📧 Consolidated Reporting**: Automated professional HTML failure reports sent via SMTP/Nodemailer, featuring throughput metrics and latency P/percentiles.
- **⏯️ Resumable States**: Intelligent checkpointing allows interrupted runs to resume exactly where they left off, skipping completed files.
- **🔍 Advanced Analytics**: Latency distribution (P50, P95, P99), throughput tracking, and detailed anomaly detection in extraction results.

---

## 🛠️ Project Structure

```text
src/
├── core/                # Pure Business Logic
│   ├── domain/          # Entities, Domain Services, Repository Interfaces
│   └── use-cases/       # Orchestration of domain logic
├── adapters/            # Gateways to the outside world
│   ├── controllers/     # Web API logic
│   ├── presenters/      # UI-ready data formatting (HTML/JSON)
│   └── router.ts        # Fast, low-dependency HTTP routing
└── infrastructure/      # Low-level implementations
    ├── database/        # SQLite / Better-SQLite3 implementations
    ├── services/        # AWS S3, Nodemailer, Parent/Child processes
    └── utils/           # Shared technical utilities (Metrics, Logging)
```

---

## 🚀 Getting Started

### 1. Requirements

- **Node.js**: v20 or higher
- **SQLite3**: (Included via `better-sqlite3`)

### 2. Setup

```bash
# Install dependencies
npm install

# Setup environment
cp .env.example .env

# Setup configuration
cp config/config.example.yaml config/config.yaml
```

### 3. Environment Configuration

Edit `.env` with your API credentials:

- `INTELLIEXTRACT_ACCESS_KEY`
- `INTELLIEXTRACT_SECRET_MESSAGE`
- `INTELLIEXTRACT_SIGNATURE`
- `S3_BUCKET` & `S3_TENANT_PURCHASERS` (for sync)

---

## 🖥️ Usage

### Development & Build

```bash
npm run build    # Compile TypeScript to dist/
npm run dev      # Start development watcher
```

### Browser App (Dashboard)

```bash
npm run app      # Starts the dashboard at http://localhost:8765
```

### CLI Mode

```bash
# Sync files from S3
npm run sync -- --limit 50

# Execute extraction with specific scope
npm start run -- --tenant BRAND_A --requestsPerSecond 5

# High-speed pipeline
node dist/index.js sync-extract --limit 100 --resume
```

---

## 🧪 Testing

The project includes a comprehensive suite of unit tests using **Vitest**.

```bash
npm test                # Run all tests
npm run test:watch      # Watch mode for TDD
npm run test:coverage   # Generate detailed coverage report
```

Current test baseline focuses on:

- Core Use Cases (Sync, Extract, Discovery)
- Domain Logic & Entity validation
- Infrastructure Utilities (Metrics & Path Normalization)

---

## 📊 Benchmarking & Reporting

Benchmarks are generated automatically during every run. View the results in:

- **Web UI**: Detailed charts in the "Analytics" tab.
- **HTML Report**: Generated under `output/reports/report_[id].html`.
- **Metrics tracked**: Throughput (files/sec), Latency distribution (avg, P50, P95, P99), and categorized Error Rates.

---

## 📜 License

© 2026 IntelliRevenue. All rights reserved.
