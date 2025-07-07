# MF Compass Sync Service

MF Compass is an automated mutual fund data synchronization and ranking system that fetches, processes, and ranks mutual funds based on their historical performance across multiple time periods. It provides data-driven insights for investment decisions by systematically analyzing fund performance rather than relying on marketing hype.

## Overview

Built with Node.js and PostgreSQL, MF Compass automatically fetches mutual fund data from public APIs, applies sophisticated filtering to focus on high-quality funds, calculates returns across 13 different time periods, and generates weighted performance scores. The system runs automated daily updates via GitHub Actions to maintain fresh data.

## Key Features

### Intelligent Fund Selection
- **Direct Plans Only**: Filters for lower expense ratio funds
- **Growth Options**: Excludes dividend/IDCW variants for better compounding
- **Category Focus**: Targets specific equity and hybrid fund categories
- **Index Benchmarks**: Includes selected index funds for performance comparison

### Comprehensive Performance Analysis
- **13 Time Periods**: 1D, 1W, 1M, 3M, 6M, YTD, 1Y, 2Y, 3Y, 5Y, 7Y, 10Y, 12Y, Since Inception
- **Smart Calculations**: Handles weekends/holidays for daily returns, annualizes long-term returns
- **Age-Agnostic Scoring**: Funds ranked based on available track record, not penalized for being newer
- **Weighted Scoring**: Sophisticated algorithm emphasizing 1-year returns (20% weight) while considering all time horizons

### Automated Operations
- **Daily Updates**: Fetches latest NAVs and recalculates performance metrics
- **Database Rebuild**: Complete refresh capability for maintenance or schema changes
- **Connection Testing**: Built-in database connectivity verification
- **Error Handling**: Comprehensive logging and failure recovery

## Technology Stack

- **Runtime**: Node.js 18
- **Database**: PostgreSQL (Neon.tech cloud hosting)
- **HTTP Client**: Axios for API communication
- **Database Client**: pg (PostgreSQL driver)
- **Environment**: dotenv for configuration management
- **Automation**: GitHub Actions for CI/CD and scheduled tasks

## Database Schema

### Core Tables

#### `funds` Table
```sql
scheme_code INTEGER PRIMARY KEY    -- Unique fund identifier
scheme_name TEXT                   -- Fund name
fund_house TEXT                    -- AMC name
scheme_category TEXT               -- Fund category
isin_growth VARCHAR(50)           -- ISIN for growth option
inception_date DATE               -- Fund launch date
current_nav DECIMAL(10,5)         -- Latest NAV
last_updated TIMESTAMP            -- Last update time
```

#### `nav_history` Table
```sql
scheme_code INTEGER               -- Foreign key to funds
nav_date DATE                    -- NAV date
nav DECIMAL(10,5)                -- NAV value
UNIQUE(scheme_code, nav_date)    -- Prevent duplicates
```

#### `fund_returns` Table
```sql
scheme_code INTEGER              -- Foreign key to funds
return_1d through return_12y     -- Returns for different periods
return_since_inception          -- Complete fund lifecycle return
score DECIMAL(8,4)              -- Weighted composite score
calculation_date DATE           -- When returns were calculated
```

### Performance Optimizations
- Strategic indexing on scheme_code, dates, and scores
- Bulk insert operations for historical data
- Efficient batch processing for API calls

## Automated Workflows

### Daily Updates (10:30 AM IST)
1. **Connection Test**: Verify database connectivity
2. **NAV Fetch**: Get latest NAVs from API (only if not already present)
3. **Returns Calculation**: Update performance metrics for funds with new data
4. **Score Update**: Recalculate weighted scores

### Database Rebuild (Manual)
1. **Connection Test**: Verify database connectivity
2. **Database Flush**: Clean all existing data
3. **Fresh Seed**: Populate with complete historical data and calculations

## Data Source
- **API**: https://api.mfapi.in
- **Endpoints**: 
  - `/mf` - List all funds
  - `/mf/{scheme_code}` - Get fund details with historical NAV
  - `/mf/{scheme_code}/latest` - Get latest NAV only


## Getting Started

### Prerequisites
- Node.js 18+
- PostgreSQL database (Neon.tech recommended)
- GitHub account for automation

### Local Setup

1. **Clone and Install**
```bash
git clone https://github.com/yourusername/mf-compass-sync.git
cd mf-compass-sync
npm install
```

2. **Configure Environment** (.env file)
```env
DATABASE_URL=postgresql://user:password@host:port/database
DB_HOST=your_db_host
DB_PORT=5432
DB_NAME=your_db_name
DB_USER=your_db_user
DB_PASSWORD=your_db_password
MF_API_BASE_URL=https://api.mfapi.in
NODE_ENV=production
```

3. **Initialize Database**
```bash
npm run test-db    # Test connection
npm run seed       # Initial data load
```

4. **Daily Operations**
```bash
npm run daily-update    # Update with latest NAVs
```

### GitHub Actions Deployment

1. **Create GitHub Repository**
2. **Add Repository Secrets**:
   - `DATABASE_URL`
   - `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`
   - `MF_API_BASE_URL`

3. **Push Code** - Workflows will automatically set up daily updates

## Available Scripts

| Script | Description | Use Case |
|--------|-------------|----------|
| `npm run test-db` | Test database connection | Setup verification |
| `npm run seed` | Initial database population | First-time setup |
| `npm run daily-update` | Fetch latest NAVs and update | Daily maintenance |
| `npm run flush-db` | Complete database cleanup | Maintenance/reset |

## Fund Selection Criteria

### Included Fund Categories
- Equity Scheme - Large Cap Fund
- Equity Scheme - Mid Cap Fund  
- Equity Scheme - Small Cap Fund
- Equity Scheme - Flexi Cap Fund
- Hybrid Scheme - Aggressive Hybrid Fund
- Hybrid Scheme - Dynamic Asset Allocation or Balanced Advantage
- Hybrid Scheme - Multi Asset Allocation

### Specific Index Funds
- Motilal Oswal Nifty 50 Index Fund
- Motilal Oswal Nifty Next 50 Index Fund
- Motilal Oswal Nifty Midcap 150 Index Fund
- Motilal Oswal Nifty Smallcap 250 Index Fund
- Motilal Oswal Nifty 500 Index Fund

## Business Intelligence Value

MF Compass solves critical mutual fund selection challenges:

- **Eliminates Marketing Bias**: Pure data-driven rankings
- **Comprehensive Analysis**: Multiple time horizons reveal consistency patterns
- **Quality Focus**: Automatic filtering for investor-friendly fund variants
- **Automated Maintenance**: Regular updates without manual intervention
- **Fair Comparison**: Age-agnostic scoring allows comparison across fund vintages

## Architecture Benefits

- **Scalable**: Cloud-hosted database with efficient batch processing
- **Reliable**: Comprehensive error handling and transaction management
- **Maintainable**: Clean separation of concerns and modular design
- **Secure**: Environment-based configuration with GitHub Secrets
- **Cost-effective**: Uses free/low-cost services for automation

## Use Cases

1. **Fund Discovery**: Identify top-performing funds in specific categories
2. **Performance Analysis**: Compare funds across multiple time horizons
3. **Risk Assessment**: Evaluate consistency across different market cycles
4. **Benchmarking**: Compare active funds against index alternatives
5. **Portfolio Construction**: Data-driven fund selection for investment portfolios