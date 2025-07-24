# MF Compass Sync Service

A comprehensive mutual fund data synchronization and scoring system that automatically discovers, processes, and ranks mutual funds based on outperformance over category averages using the Kuvera API. Built with Node.js and PostgreSQL, it provides intelligent fund selection and automated data maintenance for investment decision-making.

## Overview

MF Compass Sync Service is a financial data processing system that:
- Automatically discovers mutual funds from equity categories using the Kuvera API
- Applies intelligent filtering to focus on high-quality, investor-friendly funds
- Calculates weighted outperformance scores based on how funds perform relative to their category averages
- Maintains fresh data through automated syncing and manual flushes
- Provides category-wise rankings for fair fund comparison within peer groups

## Key Features

- Direct Plans Only: Filters for lower expense ratio funds
- Growth Options: Excludes dividend/IDCW variants for better compounding
- Category Focus: Targets specific equity fund categories (Large, Mid, Small, Flexi Cap)
- Quality Filters: Removes poorly rated funds and low-AUM funds
- Multi-stage Filtering: Progressive filters ensure only high-quality funds
- Comprehensive Performance Analysis: Multi-period returns and outperformance-based scoring
- Category-wise Normalization: Fair comparison within fund categories
- Data Freshness Detection: Updates only when new data is available
- Graceful Data Handling: Handles missing data through dynamic weight adjustment

## Technology Stack

- Runtime: Node.js 18
- Database: PostgreSQL (dual-table architecture)
- API Integration: Kuvera API for fund data and category averages
- HTTP Client: Axios
- Database Client: pg (PostgreSQL driver)
- Environment: dotenv for configuration management

## Database Architecture

### Dual Table Design

#### `funds` Table
```sql
CREATE TABLE funds (
  id SERIAL PRIMARY KEY,
  kuvera_code TEXT UNIQUE NOT NULL,
  scheme_name TEXT NOT NULL,
  isin TEXT,
  fund_house TEXT,
  fund_house_name TEXT,
  fund_category TEXT,
  fund_type TEXT,
  lump_available VARCHAR(1),
  lump_min DECIMAL(15,2),
  sip_available VARCHAR(1),
  sip_min DECIMAL(15,2),
  lock_in_period INTEGER,
  current_nav DECIMAL(10,5),
  current_nav_date DATE,
  t1_nav DECIMAL(10,5),
  t1_nav_date DATE,
  returns_1d DECIMAL(8,4),
  returns_1w DECIMAL(8,4),
  returns_1y DECIMAL(8,4),
  returns_3y DECIMAL(8,4),
  returns_5y DECIMAL(8,4),
  returns_inception DECIMAL(8,4),
  returns_date DATE,
  start_date DATE,
  expense_ratio DECIMAL(5,2),
  fund_managers JSONB,
  investment_objective TEXT,
  volatility DECIMAL(8,4),
  portfolio_turnover DECIMAL(8,4),
  aum DECIMAL(15,2),
  fund_rating INTEGER,
  crisil_rating TEXT,
  total_score DECIMAL(5,2),
  score_updated TIMESTAMP,
  last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### `category_averages` Table
```sql
CREATE TABLE category_averages (
  id SERIAL PRIMARY KEY,
  category_name TEXT UNIQUE NOT NULL,
  report_date DATE NOT NULL,
  returns_1w DECIMAL(8,4),
  returns_1y DECIMAL(8,4),
  returns_3y DECIMAL(8,4),
  returns_5y DECIMAL(8,4),
  returns_inception DECIMAL(8,4),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Performance Indexes
```sql
CREATE INDEX idx_funds_kuvera_code ON funds(kuvera_code);
CREATE INDEX idx_funds_isin ON funds(isin);
CREATE INDEX idx_funds_fund_category ON funds(fund_category);
CREATE INDEX idx_funds_fund_house ON funds(fund_house);
CREATE INDEX idx_funds_fund_type ON funds(fund_type);
CREATE INDEX idx_funds_total_score ON funds(total_score DESC);
CREATE INDEX idx_category_averages_category_name ON category_averages(category_name);
CREATE INDEX idx_category_averages_report_date ON category_averages(report_date);
```

## Data Source: Kuvera API

### Primary Endpoints

| Purpose | Endpoint |
|---------|----------|
| Fund List | `https://api.kuvera.in/mf/api/v4/fund_schemes/list.json` |
| Fund Details | `https://api.kuvera.in/mf/api/v5/fund_schemes/{code}.json` |
| Category Averages | `https://api.kuvera.in/mf/api/v4/fund_categories.json` |

### Fund Categories Included
- Large Cap Fund
- Mid Cap Fund
- Small Cap Fund
- Flexi Cap Fund

## Scoring System

Scores are calculated based on outperformance over category averages, with normalization for fair comparison within categories.

## System Operations

### Available Scripts

| Script | Description | Use Case |
|--------|-------------|----------|
| `npm run test` | Test all system components | Health verification |
| `npm run sync` | Initial database population | First-time setup or scheduled refresh |
| `npm run flush` | Complete database cleanup | Maintenance/reset |

### Data Processing Pipeline

| **Sync Process** | **Flush Process** |
|:-------------------:|:------------------:|
| API Discovery → Category Filtering → Quality Filters → Category Averages → Database Storage → Outperformance Scoring → Normalization | Table Removal → Index Cleanup → Sequence Cleanup → Verification |

## Getting Started

1. Clone and install dependencies
2. Configure your .env file
3. Run `npm run sync` to populate the database
4. Use `npm run flush` for cleanup
5. Use `npm run test` to verify system health

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Submit a pull request

## Support

For issues, questions, or contributions:
- Create an issue in the GitHub repository
- Check the automated workflow logs for operational status