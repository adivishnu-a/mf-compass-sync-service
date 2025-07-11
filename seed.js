const { Pool } = require('pg');
require('dotenv').config();
const axios = require('axios');

// Import service modules
const kuveraListService = require('./kuvera-list-service');
const scoringUtils = require('./scoring-utils');

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function seedDatabase() {
  console.log('🚀 Starting MF Compass Database Seeding Process...\n');
  
  try {
    // Stage 0: Pre-flight Check
    console.log('📋 Stage 0: Pre-flight Check');
    const skipSeeding = await checkExistingData();
    
    if (skipSeeding) {
      console.log('⚠️ Database already contains fund data. Skipping seeding.');
      console.log('💡 Run flush operation first if you want to reseed.');
      return;
    }
    
    // Stage 1: Initial Fund Discovery
    console.log('\n🔍 Stage 1: Initial Fund Discovery');
    const fundCodes = await discoverFunds();
    
    if (fundCodes.length === 0) {
      throw new Error('No eligible funds found during discovery');
    }
    
    // Stage 2: Detailed Information Retrieval
    console.log('\n📊 Stage 2: Detailed Information Retrieval');
    const fundDetails = await retrieveFundDetails(fundCodes);
    
    if (fundDetails.length === 0) {
      throw new Error('No valid fund details retrieved');
    }
    
    // Stage 3: Advanced Filtering
    console.log('\n🎯 Stage 3: Advanced Filtering');
    const filteredFunds = await applyAdvancedFilters(fundDetails);
    
    if (filteredFunds.length === 0) {
      throw new Error('No funds passed advanced filtering');
    }
    
    // Stage 4: Database Table Creation
    console.log('\n🗄️ Stage 4: Database Table Creation');
    await createDatabaseTables();
    
    // Stage 5: Category Averages Processing
    console.log('\n📈 Stage 5: Category Averages Processing');
    await processCategoryAverages();
    
    // Stage 6: Data Processing & Storage
    console.log('\n💾 Stage 6: Data Processing & Storage');
    await processAndStoreFunds(filteredFunds);
    
    // Stage 7: Score Calculation & Normalization
    console.log('\n📈 Stage 7: Score Calculation & Normalization');
    await calculateAndNormalizeScores();
    
    // Stage 8: Remove funds with total_score < 70
    console.log('\n🧹 Stage 8: Removing funds with total_score < 70');
    const client = await pool.connect();
    try {
      const res = await client.query('DELETE FROM funds WHERE total_score < 70 RETURNING kuvera_code, scheme_name, total_score');
      console.log(`Removed ${res.rowCount} funds with total_score < 70`);
      if (res.rowCount > 0) {
        res.rows.slice(0, 5).forEach(row => {
          console.log(`  - ${row.scheme_name} (score: ${row.total_score})`);
        });
        if (res.rowCount > 5) {
          console.log(`  ...and ${res.rowCount - 5} more`);
        }
      }
    } finally {
      client.release();
    }
    
    console.log('\n✅ Database seeding completed successfully!');
    console.log(`📊 Total funds processed: ${filteredFunds.length}`);
    
  } catch (error) {
    console.error('\n❌ Database seeding failed:', error.message);
    throw error;
  } finally {
    await pool.end();
  }
}

async function checkExistingData() {
  const client = await pool.connect();
  await client.query("SET TIME ZONE 'Asia/Kolkata'");
  
  try {
    // Check if funds table exists and has data
    const tableCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'funds'
      )
    `);
    
    if (!tableCheck.rows[0].exists) {
      console.log('📋 No existing funds table found - proceeding with seeding');
      return false;
    }
    
    const dataCheck = await client.query('SELECT COUNT(*) as count FROM funds');
    const fundCount = parseInt(dataCheck.rows[0].count);
    
    if (fundCount > 0) {
      console.log(`📋 Found ${fundCount} existing funds in database`);
      return true;
    }
    
    console.log('📋 Funds table exists but is empty - proceeding with seeding');
    return false;
    
  } catch (error) {
    console.log('📋 Error checking existing data - proceeding with seeding');
    return false;
  } finally {
    client.release();
  }
}

async function discoverFunds() {
  try {
    const fundCodes = await kuveraListService.getFilteredFundCodes();
    
    console.log(`✅ Found ${fundCodes.length} eligible funds after filtering`);
    
    // Show category breakdown
    const breakdown = kuveraListService.getCategoriesBreakdown(fundCodes);
    console.log('\n📈 Fund breakdown by category:');
    Object.entries(breakdown).forEach(([category, count]) => {
      console.log(`  ${category}: ${count} funds`);
    });
    
    return fundCodes;
    
  } catch (error) {
    console.error('❌ Fund discovery failed:', error.message);
    throw error;
  }
}

async function retrieveFundDetails(fundCodes) {
  console.log(`📊 Fetching detailed information for ${fundCodes.length} funds...`);
  
  try {
    const batchSize = 5;
    const delayMs = 200;
    
    const results = await kuveraListService.getFundDetailsBatch(fundCodes, batchSize, delayMs);
    
    // Process results
    const successfulFunds = [];
    const failedFunds = [];
    
    results.forEach(result => {
      if (result.success) {
        successfulFunds.push(result.data);
      } else {
        failedFunds.push(result);
      }
    });
    
    console.log(`✅ Successfully retrieved: ${successfulFunds.length} funds`);
    console.log(`❌ Failed to retrieve: ${failedFunds.length} funds`);
    
    if (failedFunds.length > 0) {
      console.log(`\n⚠️ Failed Failed to retrieve: ${failedFunds.length} funds`);
      failedFunds.slice(0, 5).forEach(failed => {
        console.log(`  - ${failed.fundCode}: ${failed.error}`);
      });
      if (failedFunds.length > 5) {
        console.log(`  ... and ${failedFunds.length - 5} more`);
      }
    }
    
    return successfulFunds;
    
  } catch (error) {
    console.error('❌ Fund details retrieval failed:', error.message);
    throw error;
  }
}

async function applyAdvancedFilters(fundDetails) {
  console.log(`🎯 Applying advanced filters to ${fundDetails.length} funds...`);
  
  const filteredFunds = [];
  let filterStats = {
    availability: 0,
    fundType: 0,
    planType: 0,
    maturity: 0,
    rating: 0,
    aum: 0,
    dataIntegrity: 0,
    indexFund: 0,
    passed: 0
  };
  
  for (const fund of fundDetails) {
    let passesFilter = true;
    
    // 3.1 Availability Filters
    const hasLumpsum = fund.lump_available === 'Y';
    const hasSip = fund.sip_available === 'Y';
    if (!hasLumpsum && !hasSip) {
      filterStats.availability++;
      passesFilter = false;
      continue;
    }
    
    // Fund Type: Must be direct plan
    if (fund.direct !== 'Y') {
      filterStats.fundType++;
      passesFilter = false;
      continue;
    }
    
    // Plan Type: Must be growth plan
    if (fund.plan !== 'GROWTH') {
      filterStats.planType++;
      passesFilter = false;
      continue;
    }
    
    // Maturity: Must be open-ended
    if (fund.maturity_type !== 'Open Ended') {
      filterStats.maturity++;
      passesFilter = false;
      continue;
    }
    
    // 3.2 Quality Filters
    // Fund Rating: Exclude poorly rated funds (1, 2, 3)
    if (fund.fund_rating && [1, 2].includes(fund.fund_rating)) {
      filterStats.rating++;
      passesFilter = false;
      continue;
    }
    
    // AUM Threshold: Minimum ₹10 crores
    if (fund.aum && (fund.aum / 10) < 10) {
      filterStats.aum++;
      passesFilter = false;
      continue;
    }
    
    // 3.3 Data Integrity
    if (!fund.name || !fund.code) {
      filterStats.dataIntegrity++;
      passesFilter = false;
      continue;
    }
    
    // 3.4 Exclude Index Funds containing 'Nifty' anywhere in the name (case-insensitive)
    if (fund.name && fund.name.toLowerCase().includes('nifty')) {
      filterStats.indexFund = (filterStats.indexFund || 0) + 1;
      passesFilter = false;
      continue;
    }
    
    if (passesFilter) {
      filteredFunds.push(fund);
      filterStats.passed++;
    }
  }
  
  console.log(`✅ Funds passed advanced filtering: ${filteredFunds.length}`);
  console.log('\n📊 Filter statistics:');
  console.log(`  - Failed availability check: ${filterStats.availability}`);
  console.log(`  - Failed fund type check: ${filterStats.fundType}`);
  console.log(`  - Failed plan type check: ${filterStats.planType}`);
  console.log(`  - Failed maturity check: ${filterStats.maturity}`);
  console.log(`  - Failed rating check: ${filterStats.rating}`);
  console.log(`  - Failed AUM check: ${filterStats.aum}`);
  console.log(`  - Failed data integrity check: ${filterStats.dataIntegrity}`);
  console.log(`  - Excluded index funds named 'Nifty': ${filterStats.indexFund || 0}`);
  console.log(`  - Passed all filters: ${filterStats.passed}`);
  
  return filteredFunds;
}

async function createDatabaseTables() {
  const client = await pool.connect();
  await client.query("SET TIME ZONE 'Asia/Kolkata'");
  
  try {
    await client.query('BEGIN');
    
    console.log('🗄️ Creating funds table...');
    
    // Create comprehensive funds table
    await client.query(`
      CREATE TABLE IF NOT EXISTS funds (
        -- Primary Keys & Identifiers
        id SERIAL PRIMARY KEY,
        kuvera_code TEXT UNIQUE NOT NULL,
        scheme_name TEXT NOT NULL,
        isin TEXT,
        
        -- Fund House Information
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
        detail_info TEXT,
        
        -- NAV Data
        current_nav DECIMAL(10,5),
        current_nav_date DATE,
        t1_nav DECIMAL(10,5),
        t1_nav_date DATE,
        
        -- Performance Returns (in percentage)
        returns_1d DECIMAL(8,4),
        returns_1w DECIMAL(8,4),
        returns_1y DECIMAL(8,4),
        returns_3y DECIMAL(8,4),
        returns_5y DECIMAL(8,4),
        returns_inception DECIMAL(8,4),
        returns_date DATE,
        
        -- Fund Metadata
        start_date DATE,              -- Fund inception date
        expense_ratio DECIMAL(5,2),   -- Annual expense ratio
        expense_ratio_date DATE,      -- Date of expense ratio
        fund_managers JSONB,          -- Fund manager names as JSON array
        investment_objective TEXT,    -- Investment objective
        volatility DECIMAL(8,4),
        portfolio_turnover DECIMAL(8,4),
        aum DECIMAL(15,2),
        fund_rating INTEGER,
        fund_rating_date DATE,
        crisil_rating TEXT,
        
        -- Scoring System
        total_score DECIMAL(5,2),
        score_updated TIMESTAMP,
        
        -- Audit Fields
        last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    console.log('🗄️ Creating category_averages table...');
    
    // Create category averages table
    await client.query(`
      CREATE TABLE IF NOT EXISTS category_averages (
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
      )
    `);
    
    console.log('📇 Creating database indexes...');
    
    // Create performance indexes for funds table
    await client.query(`CREATE INDEX IF NOT EXISTS idx_funds_kuvera_code ON funds(kuvera_code)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_funds_isin ON funds(isin)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_funds_fund_category ON funds(fund_category)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_funds_fund_house ON funds(fund_house)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_funds_fund_type ON funds(fund_type)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_funds_total_score ON funds(total_score DESC)`);
    
    // Create indexes for category_averages table
    await client.query(`CREATE INDEX IF NOT EXISTS idx_category_averages_category_name ON category_averages(category_name)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_category_averages_report_date ON category_averages(report_date)`);
    
    await client.query('COMMIT');
    console.log('✅ Database tables and indexes created successfully');
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Database table creation failed:', error.message);
    throw error;
  } finally {
    client.release();
  }
}

async function processCategoryAverages() {
  console.log('📈 Fetching and processing category averages...');
  
  try {
    // Fetch category averages from Kuvera API
    const categoryAveragesUrl = 'https://api.kuvera.in/mf/api/v4/fund_categories.json';
    const response = await axios.get(categoryAveragesUrl, {
      timeout: 15000,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'MF-Compass-Sync-Service/2.0'
      }
    });
    
    if (!response.data || !Array.isArray(response.data)) {
      throw new Error('Invalid category averages response from API');
    }
    
    const categoryData = response.data;
    console.log(`✅ Fetched ${categoryData.length} category averages from API`);
    
    // Filter for categories we're interested in
    const relevantCategories = categoryData.filter(category => {
      // Check if this category is in our allowed categories
      const allowedEquityCategories = [
        'Large Cap Fund',
        'Mid Cap Fund', 
        'Small Cap Fund',
        'Flexi Cap Fund',
        'ELSS'
      ];
      
      const allowedHybridCategories = [
        'Aggressive Hybrid Fund',
        'Dynamic Asset Allocation or Balanced Advantage',
        'Multi Asset Allocation'
      ];
      
      return allowedEquityCategories.includes(category.category_name) || 
             allowedHybridCategories.includes(category.category_name);
    });
    
    console.log(`📊 Found ${relevantCategories.length} relevant categories`);
    
    // Separate hybrid and equity categories
    const hybridCategories = relevantCategories.filter(cat => 
      ['Aggressive Hybrid Fund', 'Dynamic Asset Allocation or Balanced Advantage', 'Multi Asset Allocation'].includes(cat.category_name)
    );
    
    const equityCategories = relevantCategories.filter(cat => 
      ['Large Cap Fund', 'Mid Cap Fund', 'Small Cap Fund', 'Flexi Cap Fund', 'ELSS'].includes(cat.category_name)
    );
    
    // Process categories for database storage
    const processedCategories = [];
    
    // Add equity categories directly
    equityCategories.forEach(category => {
      processedCategories.push({
        category_name: category.category_name,
        report_date: category.report_date,
        returns_1w: category.week_1,
        returns_1y: category.year_1,
        returns_3y: category.year_3,
        returns_5y: category.year_5,
        returns_inception: category.inception
      });
    });
    
    // Average the hybrid categories and save as "Hybrid"
    if (hybridCategories.length > 0) {
      const hybridAverage = {
        category_name: 'Hybrid',
        report_date: hybridCategories[0].report_date, // Use the first date (should be same for all)
        returns_1w: 0,
        returns_1y: 0,
        returns_3y: 0,
        returns_5y: 0,
        returns_inception: 0
      };
      
      // Calculate averages for each time period
      const returnFields = ['week_1', 'year_1', 'year_3', 'year_5', 'inception'];
      const targetFields = ['returns_1w', 'returns_1y', 'returns_3y', 'returns_5y', 'returns_inception'];
      
      returnFields.forEach((field, index) => {
        const validValues = hybridCategories
          .map(cat => cat[field])
          .filter(val => val !== null && val !== undefined && !isNaN(val));
        
        if (validValues.length > 0) {
          hybridAverage[targetFields[index]] = validValues.reduce((sum, val) => sum + val, 0) / validValues.length;
        }
      });
      
      processedCategories.push(hybridAverage);
      
      console.log(`📊 Averaged ${hybridCategories.length} hybrid categories into "Hybrid" category`);
    }
    
    // Store in database
    await storeCategoryAverages(processedCategories);
    
    console.log('✅ Category averages processed and stored successfully');
    
  } catch (error) {
    console.error('❌ Category averages processing failed:', error.message);
    throw error;
  }
}

async function storeCategoryAverages(categories) {
  const client = await pool.connect();
  await client.query("SET TIME ZONE 'Asia/Kolkata'");
  
  try {
    await client.query('BEGIN');
    
    console.log(`💾 Storing ${categories.length} category averages...`);
    
    for (const category of categories) {
      await client.query(`
        INSERT INTO category_averages (
          category_name, report_date, returns_1w, returns_1y, returns_3y, returns_5y, returns_inception, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
        ON CONFLICT (category_name) DO UPDATE SET
          report_date = EXCLUDED.report_date,
          returns_1w = EXCLUDED.returns_1w,
          returns_1y = EXCLUDED.returns_1y,
          returns_3y = EXCLUDED.returns_3y,
          returns_5y = EXCLUDED.returns_5y,
          returns_inception = EXCLUDED.returns_inception,
          updated_at = CURRENT_TIMESTAMP
      `, [
        category.category_name,
        category.report_date,
        category.returns_1w,
        category.returns_1y,
        category.returns_3y,
        category.returns_5y,
        category.returns_inception
      ]);
      
      console.log(`  ✓ ${category.category_name} - Report Date: ${category.report_date}`);
    }
    
    await client.query('COMMIT');
    console.log('✅ Category averages stored successfully');
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error storing category averages:', error.message);
    throw error;
  } finally {
    client.release();
  }
}

async function processAndStoreFunds(funds) {
  console.log(`💾 Processing and storing ${funds.length} funds...`);
  
  const client = await pool.connect();
  await client.query("SET TIME ZONE 'Asia/Kolkata'");
  
  const batchSize = 10;
  let processedCount = 0;
  
  try {
    for (let i = 0; i < funds.length; i += batchSize) {
      const batch = funds.slice(i, i + batchSize);
      
      await client.query('BEGIN');
      
      for (const fund of batch) {
        try {
          await processSingleFund(client, fund);
          processedCount++;
          
          // Show progress
          if (processedCount % 25 === 0 || processedCount <= 5) {
            console.log(`📊 Processed ${processedCount}/${funds.length}: ${fund.name}`);
          }
          
        } catch (error) {
          console.error(`⚠️ Error processing fund ${fund.name}:`, error.message);
        }
      }
      
      await client.query('COMMIT');
      
      // Brief pause between batches
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.log(`✅ Successfully processed ${processedCount} funds`);
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Fund processing failed:', error.message);
    throw error;
  } finally {
    client.release();
  }
}

async function processSingleFund(client, fund) {
  // 5.2 Data Transformation
  
  // NAV Data Processing
  const currentNav = fund.nav ? parseFloat(fund.nav.nav) : null;
  const currentNavDate = fund.nav ? new Date(fund.nav.date) : null;
  const t1Nav = fund.last_nav ? parseFloat(fund.last_nav.nav) : null;
  const t1NavDate = fund.last_nav ? new Date(fund.last_nav.date) : null;
  
  // Calculate 1-day returns
  let returns1d = null;
  if (currentNav && t1Nav) {
    returns1d = ((currentNav - t1Nav) / t1Nav) * 100;
  }
  
  // Returns Data Processing
  const returns1w = fund.returns ? fund.returns.week_1 : null;
  const returns1y = fund.returns ? fund.returns.year_1 : null;
  const returns3y = fund.returns ? fund.returns.year_3 : null;
  const returns5y = fund.returns ? fund.returns.year_5 : null;
  const returnsInception = fund.returns ? fund.returns.inception : null;
  const returnsDate = fund.returns ? new Date(fund.returns.date) : null;
  
  // Fund metadata processing
  const startDate = fund.start_date ? new Date(fund.start_date) : null;
  const expenseRatio = fund.expense_ratio ? parseFloat(fund.expense_ratio) : null;
  const expenseRatioDate = fund.expense_ratio_date ? new Date(fund.expense_ratio_date) : null;
  const volatility = fund.volatility ? parseFloat(fund.volatility) : null;
  const portfolioTurnover = fund.portfolio_turnover ? parseFloat(fund.portfolio_turnover) : null;
  const fundRating = fund.fund_rating ? parseInt(fund.fund_rating) : null;
  const fundRatingDate = fund.fund_rating_date ? new Date(fund.fund_rating_date) : null;
  
  // AUM Conversion (API provides in multiples of 10L, convert to crores)
  const aumInCrores = fund.aum ? fund.aum / 10 : null;
  
  // Use fund_type directly from API response
  const fundType = fund.fund_type || 'Other';
  
  // Fund managers processing - convert semicolon-separated string to JSON array
  let fundManagers = null;
  if (fund.fund_manager && typeof fund.fund_manager === 'string') {
    // Split by semicolon and clean up each name
    const managerNames = fund.fund_manager
      .split(';')
      .map(name => name.trim())
      .filter(name => name.length > 0);
    
    fundManagers = managerNames.length > 0 ? JSON.stringify(managerNames) : null;
  }
  
  // Get category averages for scoring
  const categoryAverages = await getCategoryAveragesForScoring(client);
  
  // Calculate initial raw score with category averages
  const fundDataForScoring = {
    returns_1y: returns1y,
    returns_3y: returns3y,
    returns_5y: returns5y,
    returns_1w: returns1w,
    returns_inception: returnsInception,
    fund_rating: fundRating,
    volatility: volatility,
    aum: aumInCrores,
    start_date: startDate,
    fund_category: fund.fund_category,
    fund_type: fundType
  };
  
  const scoreResult = scoringUtils.calculateFundScore(fundDataForScoring, categoryAverages);
  
  // 5.3 Database Insertion
  await client.query(`
    INSERT INTO funds (
      kuvera_code, scheme_name, isin, fund_house, fund_house_name, fund_category, fund_type,
      lump_available, lump_min, sip_available, sip_min, lock_in_period, detail_info,
      current_nav, current_nav_date, t1_nav, t1_nav_date,
      returns_1d, returns_1w, returns_1y, returns_3y, returns_5y, returns_inception, returns_date,
      start_date, expense_ratio, expense_ratio_date, fund_managers, investment_objective,
      volatility, portfolio_turnover, aum, fund_rating, fund_rating_date, crisil_rating,
      total_score, score_updated, last_updated
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
      $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32,
      $33, $34, $35, $36, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
    ON CONFLICT (kuvera_code) DO UPDATE SET
      scheme_name = EXCLUDED.scheme_name,
      isin = EXCLUDED.isin,
      fund_house = EXCLUDED.fund_house,
      fund_house_name = EXCLUDED.fund_house_name,
      fund_category = EXCLUDED.fund_category,
      fund_type = EXCLUDED.fund_type,
      lump_available = EXCLUDED.lump_available,
      lump_min = EXCLUDED.lump_min,
      sip_available = EXCLUDED.sip_available,
      sip_min = EXCLUDED.sip_min,
      lock_in_period = EXCLUDED.lock_in_period,
      detail_info = EXCLUDED.detail_info,
      current_nav = EXCLUDED.current_nav,
      current_nav_date = EXCLUDED.current_nav_date,
      t1_nav = EXCLUDED.t1_nav,
      t1_nav_date = EXCLUDED.t1_nav_date,
      returns_1d = EXCLUDED.returns_1d,
      returns_1w = EXCLUDED.returns_1w,
      returns_1y = EXCLUDED.returns_1y,
      returns_3y = EXCLUDED.returns_3y,
      returns_5y = EXCLUDED.returns_5y,
      returns_inception = EXCLUDED.returns_inception,
      returns_date = EXCLUDED.returns_date,
      start_date = EXCLUDED.start_date,
      expense_ratio = EXCLUDED.expense_ratio,
      expense_ratio_date = EXCLUDED.expense_ratio_date,
      fund_managers = EXCLUDED.fund_managers,
      investment_objective = EXCLUDED.investment_objective,
      volatility = EXCLUDED.volatility,
      portfolio_turnover = EXCLUDED.portfolio_turnover,
      aum = EXCLUDED.aum,
      fund_rating = EXCLUDED.fund_rating,
      fund_rating_date = EXCLUDED.fund_rating_date,
      crisil_rating = EXCLUDED.crisil_rating,
      total_score = EXCLUDED.total_score,
      score_updated = EXCLUDED.score_updated,
      last_updated = CURRENT_TIMESTAMP
  `, [
    fund.code,
    fund.name,
    fund.ISIN,
    fund.fund_house,
    fund.fund_name,
    fund.fund_category,
    fundType,
    fund.lump_available,
    fund.lump_min ? parseFloat(fund.lump_min) : null,
    fund.sip_available,
    fund.sip_min ? parseFloat(fund.sip_min) : null,
    fund.lock_in_period ? parseInt(fund.lock_in_period) : null,
    fund.investment_objective,
    currentNav,
    currentNavDate,
    t1Nav,
    t1NavDate,
    returns1d,
    returns1w,
    returns1y,
    returns3y,
    returns5y,
    returnsInception,
    returnsDate,
    startDate,
    expenseRatio,
    expenseRatioDate,
    fundManagers,
    fund.investment_objective,
    volatility,
    portfolioTurnover,
    aumInCrores,
    fundRating,
    fundRatingDate,
    fund.crisil_rating,
    scoreResult.total_score
  ]);
}

async function getCategoryAveragesForScoring(client) {
  try {
    const result = await client.query(`
      SELECT category_name, returns_1w, returns_1y, returns_3y, returns_5y, returns_inception
      FROM category_averages
    `);
    
    const categoryAverages = {};
    result.rows.forEach(row => {
      categoryAverages[row.category_name] = {
        returns_1w: row.returns_1w,
        returns_1y: row.returns_1y,
        returns_3y: row.returns_3y,
        returns_5y: row.returns_5y,
        returns_inception: row.returns_inception
      };
    });
    
    return categoryAverages;
  } catch (error) {
    console.warn('Failed to fetch category averages for scoring:', error.message);
    return null; // Fall back to absolute returns scoring
  }
}

async function calculateAndNormalizeScores() {
  console.log('📈 Calculating and normalizing fund scores...');
  
  const client = await pool.connect();
  await client.query("SET TIME ZONE 'Asia/Kolkata'");
  
  try {
    await client.query('BEGIN');
    
    // Get category averages for scoring
    const categoryAverages = await getCategoryAveragesForScoring(client);
    
    // Fetch all funds with their data for scoring
    const result = await client.query(`
      SELECT id, kuvera_code, scheme_name, fund_category, fund_type, 
             returns_1y, returns_3y, returns_5y, returns_1w, returns_inception,
             fund_rating, volatility, aum, start_date, total_score
      FROM funds
      ORDER BY fund_type, fund_category, total_score DESC
    `);
    
    const fundsData = result.rows;
    console.log(`📊 Recalculating scores for ${fundsData.length} funds with category averages...`);
    
    // Recalculate scores for all funds with category averages
    for (const fund of fundsData) {
      const fundDataForScoring = {
        returns_1y: fund.returns_1y,
        returns_3y: fund.returns_3y,
        returns_5y: fund.returns_5y,
        returns_1w: fund.returns_1w,
        returns_inception: fund.returns_inception,
        fund_rating: fund.fund_rating,
        volatility: fund.volatility,
        aum: fund.aum,
        start_date: fund.start_date,
        fund_category: fund.fund_category,
        fund_type: fund.fund_type
      };
      
      const scoreResult = scoringUtils.calculateFundScore(fundDataForScoring, categoryAverages);
      
      // Update fund score in database
      await client.query(`
        UPDATE funds 
        SET total_score = $1, score_updated = CURRENT_TIMESTAMP
        WHERE id = $2
      `, [scoreResult.total_score, fund.id]);
      
      // Update the fund object for normalization
      fund.total_score = scoreResult.total_score;
    }
    
    // Normalize scores using scoring utils
    const normalizedFunds = scoringUtils.normalizeFundScores(fundsData);
    
    // Update database with normalized scores
    for (const fund of normalizedFunds) {
      await client.query(`
        UPDATE funds 
        SET total_score = $1, score_updated = CURRENT_TIMESTAMP
        WHERE id = $2
      `, [fund.total_score, fund.id]);
    }
    
    await client.query('COMMIT');
    
    // Generate category statistics
    const categoryStats = scoringUtils.getCategoryStatistics(normalizedFunds);
    
    console.log('✅ Score normalization completed');
    console.log('\n📊 Category-wise score statistics:');
    Object.entries(categoryStats).forEach(([category, stats]) => {
      console.log(`  ${category}:`);
      console.log(`    Count: ${stats.count}`);
      console.log(`    Avg Score: ${stats.avgScore}`);
      console.log(`    Range: ${stats.minScore} - ${stats.maxScore}`);
    });
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Score calculation failed:', error.message);
    throw error;
  } finally {
    client.release();
  }
}

// Run the seeder
if (require.main === module) {
  seedDatabase()
    .then(() => {
      console.log('\n✅ Seeding process completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Seeding process failed:', error);
      process.exit(1);
    });
}

module.exports = { seedDatabase };