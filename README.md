# MF Compass Sync Service

A comprehensive mutual fund data synchronization and scoring system that automatically discovers, processes, and ranks mutual funds based on **outperformance over category averages** using the Kuvera API. Built with Node.js and PostgreSQL, it provides intelligent fund selection and automated data maintenance for investment decision-making.

## Overview

MF Compass Sync Service is a sophisticated financial data processing system that:
- **Automatically discovers** mutual funds from multiple categories using the Kuvera API
- **Applies intelligent filtering** to focus on high-quality, investor-friendly funds
- **Calculates weighted outperformance scores** based on how funds perform relative to their category averages
- **Maintains fresh data** through automated daily updates and monthly rebuilds
- **Provides category-wise rankings** for fair fund comparison within peer groups

## Key Features

### 🎯 Intelligent Fund Discovery
- **Direct Plans Only**: Filters for lower expense ratio funds
- **Growth Options**: Excludes dividend/IDCW variants for better compounding
- **Category Focus**: Targets specific equity and hybrid fund categories
- **Quality Filters**: Removes poorly rated funds and low-AUM funds
- **Multi-stage Filtering**: Progressive filters ensure only high-quality funds

### 📊 Comprehensive Performance Analysis
- **Multi-period Returns**: 1D, 1W, 1Y, 3Y, 5Y, and since inception tracking
- **Outperformance-based Scoring**: Measures how much funds beat their category averages
- **Category-wise Normalization**: Fair comparison within fund categories
- **Data Freshness Detection**: Updates only when new data is available
- **Graceful Data Handling**: Handles missing data through dynamic weight adjustment

### 🤖 Automated Operations
- **Daily Updates**: Twice-daily NAV updates (12:15 AM & 10:15 AM IST)
- **Monthly Rebuilds**: Complete database refresh on 2nd of each month
- **Manual Operations**: On-demand execution of any system operation
- **GitHub Actions**: Fully automated CI/CD with comprehensive error handling

## Technology Stack

- **Runtime**: Node.js 18
- **Database**: PostgreSQL (dual-table architecture)
- **API Integration**: Kuvera API for fund data and category averages
- **HTTP Client**: Axios with timeout and retry logic
- **Database Client**: pg (PostgreSQL driver) with connection pooling
- **Environment**: dotenv for configuration management
- **Automation**: GitHub Actions for scheduled operations

## Database Architecture

### Dual Table Design

The system uses an optimized dual-table architecture:

#### `funds` Table
```sql
CREATE TABLE funds (
-- Identity & Classification
id SERIAL PRIMARY KEY,
kuvera_code TEXT UNIQUE NOT NULL,
scheme_name TEXT NOT NULL,
isin TEXT,
fund_house TEXT,
fund_house_name TEXT,
fund_category TEXT,
fund_type TEXT,

-- Investment Options
lump_available VARCHAR(1),
lump_min DECIMAL(15,2),
sip_available VARCHAR(1),
sip_min DECIMAL(15,2),
lock_in_period INTEGER,

-- NAV Data
current_nav DECIMAL(10,5),
current_nav_date DATE,
t1_nav DECIMAL(10,5),
t1_nav_date DATE,

-- Performance Returns
returns_1d DECIMAL(8,4),
returns_1w DECIMAL(8,4),
returns_1y DECIMAL(8,4),
returns_3y DECIMAL(8,4),
returns_5y DECIMAL(8,4),
returns_inception DECIMAL(8,4),
returns_date DATE,

-- Fund Metrics
start_date DATE,
expense_ratio DECIMAL(5,2),
fund_managers JSONB,
investment_objective TEXT,
volatility DECIMAL(8,4),
portfolio_turnover DECIMAL(8,4),
aum DECIMAL(15,2),
fund_rating INTEGER,
crisil_rating TEXT,

-- Scoring System
total_score DECIMAL(5,2),
score_updated TIMESTAMP,

-- Audit Fields
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
-- Funds table indexes
CREATE INDEX idx_funds_kuvera_code ON funds(kuvera_code);
CREATE INDEX idx_funds_isin ON funds(isin);
CREATE INDEX idx_funds_fund_category ON funds(fund_category);
CREATE INDEX idx_funds_fund_house ON funds(fund_house);
CREATE INDEX idx_funds_fund_type ON funds(fund_type);
CREATE INDEX idx_funds_total_score ON funds(total_score DESC);

-- Category averages indexes
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
**Equity Funds:**
- Large Cap Fund
- Mid Cap Fund
- Small Cap Fund
- Flexi Cap Fund
- ELSS (Equity Linked Savings Scheme)

**Hybrid Funds (Averaged):**
- Aggressive Hybrid Fund
- Dynamic Asset Allocation or Balanced Advantage
- Multi Asset Allocation

*Note: The three hybrid categories are averaged into a single "Hybrid" benchmark for scoring purposes.*

## Scoring System

### Outperformance-Based Scoring
The system calculates fund scores based on **outperformance over category averages** rather than absolute returns:

```javascript
- 1-Year Returns: Most important for recent upside capture- full market cycle
- 3-Year Returns: Medium-term consistency
- 5-Year Returns: Long-term performance
- 1-Week Returns: Recent momentum
```

## System Operations

### Available Scripts

| Script | Description | Use Case |
|--------|-------------|----------|
| `npm run test` | Test all system components | Health verification |
| `npm run seed` | Initial database population | First-time setup |
| `npm run update` | Daily NAV updates | Regular maintenance |
| `npm run flush` | Complete database cleanup | Maintenance/reset |

### Data Processing Pipeline

| **Seeding Process (Monthly)** | **Update Process (Daily)** | **Flush Process (Manual)** |
|:-----------------------------:|:--------------------------:|:---------------------------:|
| API Discovery<br>↓<br>Category Filtering<br>↓<br>Quality Filters<br>↓<br>**Category Averages**<br>↓<br>Database Storage<br>↓<br>**Outperformance Scoring**<br>↓<br>Normalization | Database Query<br>↓<br>API Fetching<br>↓<br>Freshness Detection<br>↓<br>Data Updates<br>↓<br>**Outperformance Recalculation**<br>↓<br>Normalization | Safety Confirmation<br>↓<br>Table Removal<br>↓<br>Index Cleanup<br>↓<br>Sequence Cleanup<br>↓<br>Verification |

## Automated Workflows

### 1. Daily Update Workflow
- **Schedule**: 12:15 AM & 10:15 AM IST
- **Process**: Fetch latest NAVs and recalculate outperformance scores
- **Efficiency**: Updates only funds with new data

### 2. Monthly Rebuild Workflow
- **Schedule**: 2nd of each month at 2:00 AM IST
- **Process**: Complete database flush and fresh data load
- **Pipeline**: Test → Flush → Seed

### 3. Manual Operations Workflow
- **Trigger**: Manual execution via GitHub Actions
- **Options**: Test, Seed, Update, Flush
- **Features**: User-friendly dropdown interface

## Getting Started

### Prerequisites
- Node.js 18+
- PostgreSQL database
- GitHub account for automation

### Local Setup

1. **Clone and Install**
```bash
git clone https://github.com/adivishnu-a/mf-compass-sync-service.git
cd mf-compass-sync-service
npm install
```

2. **Configure Environment** (.env file)
```env
DATABASE_URL=postgresql://user:password@host:port/database
NODE_ENV=production
```

3. **Initialize System**
```bash
npm run test # Verify all components
npm run seed # Initial data load
npm run update # Test update process
```

### GitHub Actions Deployment

1. **Add Repository Secret**:
- `DATABASE_URL`: PostgreSQL connection string

2. **Push Code** - Workflows will automatically activate:
- Daily updates at scheduled times
- Monthly rebuilds on 2nd of each month
- Manual operations available on-demand

## Performance Metrics

### Update Efficiency
- **Batch Size**: 5 concurrent API requests
- **Processing Time**: Less than a minute for complete update
- **Category Benchmarks**: Fresh data fetched during each operation

### Data Freshness
- **NAV Updates**: Only when new data is available
- **Score Recalculation**: After every data update using latest category averages
- **Complete Rebuild**: Monthly for data integrity
- **Real-time Validation**: Comprehensive testing before operations

## Business Value

### Investment Decision Support
- **Relative Performance**: Focus on fund manager skill rather than market conditions
- **Category-appropriate Comparison**: Fair benchmarking within peer groups
- **Outperformance Identification**: Quickly identify consistently outperforming funds

### Operational Excellence
- **Automated Maintenance**: No manual intervention required
- **Dual-table Architecture**: Optimized for both performance and category analysis
- **Error Recovery**: Comprehensive error handling and logging
- **Cost-effective**: Uses free/low-cost services for automation

## Use Cases

1. **Fund Discovery**: Identify consistently outperforming funds within categories
2. **Performance Analysis**: Compare funds based on category-relative performance
3. **Portfolio Construction**: Data-driven fund selection based on outperformance
4. **Research Platform**: Foundation for category-aware financial analysis


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