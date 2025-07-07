const axios = require('axios');
const { Pool } = require('pg');
require('dotenv').config();

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// API configuration
const MF_API_BASE_URL = process.env.MF_API_BASE_URL || 'https://api.mfapi.in';

// Allowed scheme categories
const ALLOWED_CATEGORIES = [
  'Equity Scheme - Mid Cap Fund',
  'Equity Scheme - Small Cap Fund',
  'Equity Scheme - Large Cap Fund',
  'Equity Scheme - Flexi Cap Fund',
  'Hybrid Scheme - Aggressive Hybrid Fund',
  'Hybrid Scheme - Dynamic Asset Allocation or Balanced Advantage',
  'Hybrid Scheme - Multi Asset Allocation'
];

// Specific index funds to include (for index performance tracking)
const SPECIFIC_INDEX_FUNDS = [
  147794, // NIFTY 50: Motilal Oswal Nifty 50 Index Fund - Direct plan - Growth
  147796, // NIFTY NEXT 50: Motilal Oswal Nifty Next 50 Index Fund - Direct plan - Growth
  147622, // NIFTY MIDCAP 150: Motilal Oswal Nifty Midcap 150 Index Fund - Direct Plan
  147623, // NIFTY SMALLCAP 250: Motilal Oswal Nifty Smallcap 250 Index Fund- Direct Plan
  147625  // NIFTY 500: Motilal Oswal Nifty 500 Index Fund - Direct Plan
];

async function seedDatabase() {
  console.log('Starting MF Compass database seeding...');
  
  try {
    // Step 1: Fetch all mutual funds
    console.log('Step 1: Fetching all mutual funds...');
    const allFunds = await fetchAllFunds();
    console.log(`Found ${allFunds.length} total funds`);
    
    // Step 2: Filter funds based on criteria
    console.log('Step 2: Filtering funds...');
    const filteredFunds = filterFunds(allFunds);
    console.log(`After filtering: ${filteredFunds.length} funds remaining`);
    
    // Step 3: Get detailed fund information and further filter
    console.log('Step 3: Fetching detailed fund information...');
    const validFunds = await getValidFunds(filteredFunds);
    console.log(`Valid funds after detailed filtering: ${validFunds.length}`);
    
    // Step 4: Create database tables
    console.log('Step 4: Creating database tables...');
    await createTables();
    
    // Step 5: Seed the database with historical data and calculate returns
    console.log('Step 5: Seeding database with historical data and calculating returns...');
    await seedFundsData(validFunds);
    
    console.log('Database seeding completed successfully!');
    
  } catch (error) {
    console.error('Error during database seeding:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

async function fetchAllFunds() {
  try {
    const response = await axios.get(`${MF_API_BASE_URL}/mf`);
    return response.data;
  } catch (error) {
    console.error('Error fetching all funds:', error);
    throw error;
  }
}

function filterFunds(funds) {
  return funds.filter(fund => {
    // Filter out funds without isinGrowth (must not be null)
    if (!fund.isinGrowth) {
      return false;
    }
    
    // Filter out funds WITH isinDivReinvestment (must be null)
    if (fund.isinDivReinvestment !== null) {
      return false;
    }
    
    return true;
  });
}

async function getValidFunds(filteredFunds) {
  const validFunds = [];
  const batchSize = 10; // Process in batches to avoid overwhelming the API
  
  for (let i = 0; i < filteredFunds.length; i += batchSize) {
    const batch = filteredFunds.slice(i, i + batchSize);
    const batchPromises = batch.map(fund => getFundDetails(fund));
    
    try {
      const batchResults = await Promise.allSettled(batchPromises);
      
      batchResults.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value) {
          validFunds.push(result.value);
        } else if (result.status === 'rejected') {
          console.warn(`Failed to fetch details for fund ${batch[index].schemeCode}:`, result.reason?.message);
        }
      });
      
      // Add delay between batches to be respectful to the API
      if (i + batchSize < filteredFunds.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      console.log(`Processed batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(filteredFunds.length / batchSize)}`);
      
    } catch (error) {
      console.error(`Error processing batch starting at index ${i}:`, error);
    }
  }
  
  return validFunds;
}

async function getFundDetails(fund) {
  try {
    const response = await axios.get(`${MF_API_BASE_URL}/mf/${fund.schemeCode}`);
    const fundData = response.data;
    
    if (fundData.status !== 'SUCCESS' || !fundData.meta) {
      return null;
    }
    
    const meta = fundData.meta;
    
    // Filter: Must contain "Direct" in scheme name (case-insensitive)
    if (!meta.scheme_name.toLowerCase().includes('direct')) {
      return null;
    }
    
    // Filter: Exclude funds with IDCW, Reinvestment, Dividend, Payout, Income Distribution (case-insensitive)
    const excludeKeywords = ['idcw', 'reinvestment', 'segregated', 'portfolio', 'bonus', 'dividend', 'payout', 'income distribution'];
    const schemeNameLower = meta.scheme_name.toLowerCase();
    
    if (excludeKeywords.some(keyword => schemeNameLower.includes(keyword))) {
      return null;
    }
    
    // Filter: Must be in allowed categories OR be one of the specific index funds
    const isAllowedCategory = ALLOWED_CATEGORIES.includes(meta.scheme_category);
    const isSpecificIndexFund = SPECIFIC_INDEX_FUNDS.includes(parseInt(fund.schemeCode));
    
    if (!isAllowedCategory && !isSpecificIndexFund) {
      return null;
    }
    
    // Return the complete fund data with historical NAV
    return {
      meta: meta,
      data: fundData.data
    };
    
  } catch (error) {
    console.error(`Error fetching details for fund ${fund.schemeCode}:`, error.message);
    return null;
  }
}

function calculateReturns(navData) {
  // Sort NAV data by date (newest first)
  const sortedNavData = navData.sort((a, b) => new Date(convertDateFormat(b.date)) - new Date(convertDateFormat(a.date)));
  
  // Find the most recent available NAV (current NAV for calculation)
  const currentNav = parseFloat(sortedNavData[0].nav);
  const currentNavDate = new Date(convertDateFormat(sortedNavData[0].date));
  
  // Use today's actual date for time delta calculations
  const todayActualDate = new Date();
  
  const timeframes = {
    '1D': { type: 'days', value: 1 },
    '1W': { type: 'days', value: 7 },
    '1M': { type: 'months', value: 1 },
    '3M': { type: 'months', value: 3 },
    '6M': { type: 'months', value: 6 },
    'YTD': { type: 'ytd', value: getDaysFromYearStart(todayActualDate) },
    '1Y': { type: 'years', value: 1 },
    '2Y': { type: 'years', value: 2 },
    '3Y': { type: 'years', value: 3 },
    '5Y': { type: 'years', value: 5 },
    '7Y': { type: 'years', value: 7 },
    '10Y': { type: 'years', value: 10 },
    '12Y': { type: 'years', value: 12 }
  };
  
  const returns = {};
  const fundInceptionDate = new Date(convertDateFormat(sortedNavData[sortedNavData.length - 1].date));
  const fundAgeInDays = Math.floor((todayActualDate - fundInceptionDate) / (1000 * 60 * 60 * 24));
  
  // Calculate returns for each timeframe
  Object.entries(timeframes).forEach(([period, timeframe]) => {
    let historicalNavData;
    
    // Special handling for 1D returns during holidays/weekends
    if (period === '1D') {
      // For 1D, always use the most recent NAV vs its previous NAV
      if (sortedNavData.length >= 2) {
        const currentNav = parseFloat(sortedNavData[0].nav);
        const previousNav = parseFloat(sortedNavData[1].nav);
        
        historicalNavData = {
          nav: previousNav,
          date: sortedNavData[1].date,
          targetDate: 'Previous Trading Day'
        };
      } else {
        historicalNavData = { nav: null, date: null, targetDate: 'Previous Trading Day' };
      }
    } else {
      // For all other periods, use the standard time-based calculation
      historicalNavData = getNavForTimeframeWithDetails(sortedNavData, timeframe, todayActualDate);
    }
    
    // Calculate minimum age required based on timeframe type
    let minimumAgeInDays;
    if (timeframe.type === 'days') {
      minimumAgeInDays = timeframe.value;
    } else if (timeframe.type === 'months') {
      minimumAgeInDays = timeframe.value * 30; // Approximate
    } else if (timeframe.type === 'years') {
      minimumAgeInDays = timeframe.value * 365;
    } else if (timeframe.type === 'ytd') {
      minimumAgeInDays = timeframe.value;
    }
    
    // For 1D, we only need at least 2 NAV entries
    if (period === '1D') {
      minimumAgeInDays = 1; // At least 1 day old
    }
    
    if (historicalNavData.nav && fundAgeInDays >= minimumAgeInDays) {
      const simpleReturn = ((currentNav - historicalNavData.nav) / historicalNavData.nav) * 100;
      
      // Annualize returns for periods > 1Y
      const isLongTerm = (timeframe.type === 'years' && timeframe.value > 1) || 
                        (timeframe.type === 'months' && timeframe.value >= 12);
      
      if (isLongTerm) {
        const years = timeframe.type === 'years' ? timeframe.value : timeframe.value / 12;
        const annualizedReturn = (Math.pow(currentNav / historicalNavData.nav, 1 / years) - 1) * 100;
        returns[period] = {
          value: annualizedReturn,
          annualized: true,
          timeframe: timeframe,
          historical_nav: historicalNavData.nav,
          historical_nav_date: historicalNavData.date,
          current_nav: currentNav,
          current_nav_date: sortedNavData[0].date,
          target_date: historicalNavData.targetDate,
          today_actual_date: todayActualDate.toISOString().split('T')[0]
        };
      } else {
        returns[period] = {
          value: simpleReturn,
          annualized: false,
          timeframe: timeframe,
          historical_nav: historicalNavData.nav,
          historical_nav_date: historicalNavData.date,
          current_nav: currentNav,
          current_nav_date: sortedNavData[0].date,
          target_date: historicalNavData.targetDate,
          today_actual_date: todayActualDate.toISOString().split('T')[0]
        };
      }
    } else {
      returns[period] = {
        value: null,
        annualized: null,
        timeframe: timeframe,
        historical_nav: null,
        historical_nav_date: null,
        current_nav: currentNav,
        current_nav_date: sortedNavData[0].date,
        target_date: historicalNavData.targetDate,
        today_actual_date: todayActualDate.toISOString().split('T')[0],
        reason: fundAgeInDays < minimumAgeInDays ? 'Fund too young' : 'NAV data not available'
      };
    }
  });
  
  // Calculate since inception return using today's actual date
  const inceptionNav = parseFloat(sortedNavData[sortedNavData.length - 1].nav);
  const inceptionNavDate = sortedNavData[sortedNavData.length - 1].date;
  const inceptionYears = fundAgeInDays / 365;
  
  if (inceptionYears >= 1) {
    const sinceInceptionAnnualized = (Math.pow(currentNav / inceptionNav, 1 / inceptionYears) - 1) * 100;
    returns['SINCE_INCEPTION'] = {
      value: sinceInceptionAnnualized,
      annualized: true,
      timeframe: { type: 'inception', value: fundAgeInDays },
      historical_nav: inceptionNav,
      historical_nav_date: inceptionNavDate,
      current_nav: currentNav,
      current_nav_date: sortedNavData[0].date,
      today_actual_date: todayActualDate.toISOString().split('T')[0],
      inception_date: fundInceptionDate.toISOString().split('T')[0]
    };
  } else {
    const sinceInceptionSimple = ((currentNav - inceptionNav) / inceptionNav) * 100;
    returns['SINCE_INCEPTION'] = {
      value: sinceInceptionSimple,
      annualized: false,
      timeframe: { type: 'inception', value: fundAgeInDays },
      historical_nav: inceptionNav,
      historical_nav_date: inceptionNavDate,
      current_nav: currentNav,
      current_nav_date: sortedNavData[0].date,
      today_actual_date: todayActualDate.toISOString().split('T')[0],
      inception_date: fundInceptionDate.toISOString().split('T')[0]
    };
  }
  
  return returns;
}

function getNavForTimeframeWithDetails(sortedNavData, timeframe, todayActualDate) {
  const targetDate = new Date(todayActualDate);
  
  // Calculate target date based on timeframe type
  if (timeframe.type === 'days') {
    targetDate.setDate(targetDate.getDate() - timeframe.value);
  } else if (timeframe.type === 'months') {
    targetDate.setMonth(targetDate.getMonth() - timeframe.value);
  } else if (timeframe.type === 'years') {
    targetDate.setFullYear(targetDate.getFullYear() - timeframe.value);
  } else if (timeframe.type === 'ytd') {
    const yearStart = new Date(todayActualDate.getFullYear(), 0, 1);
    targetDate.setTime(yearStart.getTime());
  }
  
  // Find the most recent NAV data point on or before the target date
  for (let i = 0; i < sortedNavData.length; i++) {
    const navDate = new Date(convertDateFormat(sortedNavData[i].date));
    if (navDate <= targetDate) {
      return {
        nav: parseFloat(sortedNavData[i].nav),
        date: sortedNavData[i].date,
        targetDate: targetDate.toISOString().split('T')[0]
      };
    }
  }
  
  // If no NAV found on or before target date, return null
  return {
    nav: null,
    date: null,
    targetDate: targetDate.toISOString().split('T')[0]
  };
}

function getDaysFromYearStart(date) {
  const yearStart = new Date(date.getFullYear(), 0, 1);
  return Math.floor((date - yearStart) / (1000 * 60 * 60 * 24));
}

function convertDateFormat(dateString) {
  // Convert from DD-MM-YYYY to YYYY-MM-DD
  const parts = dateString.split('-');
  return `${parts[2]}-${parts[1]}-${parts[0]}`;
}

async function createTables() {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Create funds table with comprehensive attributes
    await client.query(`
      CREATE TABLE IF NOT EXISTS funds (
        id SERIAL PRIMARY KEY,
        scheme_code INTEGER UNIQUE NOT NULL,
        scheme_name TEXT NOT NULL,
        fund_house TEXT NOT NULL,
        scheme_category TEXT NOT NULL,
        isin_growth VARCHAR(50),
        inception_date DATE,
        current_nav DECIMAL(10, 5),
        last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create nav_history table for time series data
    await client.query(`
      CREATE TABLE IF NOT EXISTS nav_history (
        id SERIAL PRIMARY KEY,
        scheme_code INTEGER NOT NULL,
        nav_date DATE NOT NULL,
        nav DECIMAL(10, 5) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(scheme_code, nav_date),
        FOREIGN KEY (scheme_code) REFERENCES funds(scheme_code) ON DELETE CASCADE
      )
    `);
    
    // Create returns table for calculated returns
    await client.query(`
      CREATE TABLE IF NOT EXISTS fund_returns (
        id SERIAL PRIMARY KEY,
        scheme_code INTEGER NOT NULL,
        return_1d DECIMAL(8, 4),
        return_1w DECIMAL(8, 4),
        return_1m DECIMAL(8, 4),
        return_3m DECIMAL(8, 4),
        return_6m DECIMAL(8, 4),
        return_ytd DECIMAL(8, 4),
        return_1y DECIMAL(8, 4),
        return_2y DECIMAL(8, 4),
        return_3y DECIMAL(8, 4),
        return_5y DECIMAL(8, 4),
        return_7y DECIMAL(8, 4),
        return_10y DECIMAL(8, 4),
        return_12y DECIMAL(8, 4),
        return_since_inception DECIMAL(8, 4),
        score DECIMAL(8, 4),
        calculation_date DATE NOT NULL,
        last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(scheme_code, calculation_date),
        FOREIGN KEY (scheme_code) REFERENCES funds(scheme_code) ON DELETE CASCADE
      )
    `);
    
    // Create indexes for performance
    await client.query(`CREATE INDEX IF NOT EXISTS idx_funds_scheme_code ON funds(scheme_code)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_funds_category ON funds(scheme_category)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_funds_fund_house ON funds(fund_house)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_nav_history_scheme_code ON nav_history(scheme_code)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_nav_history_date ON nav_history(nav_date DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_nav_history_scheme_date ON nav_history(scheme_code, nav_date DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_fund_returns_scheme_code ON fund_returns(scheme_code)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_fund_returns_calculation_date ON fund_returns(calculation_date DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_fund_returns_score ON fund_returns(score DESC)`);
    
    await client.query('COMMIT');
    console.log('Database tables created successfully');
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creating tables:', error);
    throw error;
  } finally {
    client.release();
  }
}

async function seedFundsData(validFunds) {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    let processedCount = 0;
    const batchSize = 5; // Process funds in smaller batches for better performance
    
    for (let i = 0; i < validFunds.length; i += batchSize) {
      const batch = validFunds.slice(i, i + batchSize);
      
      // Process batch of funds
      for (const fund of batch) {
        const meta = fund.meta;
        const navData = fund.data;
        
        // Get inception date and current NAV
        const inceptionDate = convertDateFormat(navData[navData.length - 1].date);
        const currentNav = parseFloat(navData[0].nav);
        
        // Calculate returns for this fund
        const returns = calculateReturns(navData);
        
        // Calculate weighted score for this fund
        const scoreData = calculateOverallWeightedScore(returns);
        
        // Insert fund metadata
        await client.query(`
          INSERT INTO funds (
            scheme_code, scheme_name, fund_house, scheme_category, 
            isin_growth, inception_date, current_nav, last_updated
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
          ON CONFLICT (scheme_code) 
          DO UPDATE SET 
            scheme_name = EXCLUDED.scheme_name,
            fund_house = EXCLUDED.fund_house,
            scheme_category = EXCLUDED.scheme_category,
            isin_growth = EXCLUDED.isin_growth,
            inception_date = EXCLUDED.inception_date,
            current_nav = EXCLUDED.current_nav,
            last_updated = CURRENT_TIMESTAMP
        `, [
          meta.scheme_code,
          meta.scheme_name,
          meta.fund_house,
          meta.scheme_category,
          meta.isin_growth,
          inceptionDate,
          currentNav
        ]);
        
        // OPTIMIZED: Bulk insert NAV history using VALUES clause
        if (navData.length > 0) {
          const navValues = navData.map(navEntry => {
            const navDate = convertDateFormat(navEntry.date);
            const navValue = parseFloat(navEntry.nav);
            return `(${meta.scheme_code}, '${navDate}', ${navValue})`;
          }).join(',');
          
          await client.query(`
            INSERT INTO nav_history (scheme_code, nav_date, nav)
            VALUES ${navValues}
            ON CONFLICT (scheme_code, nav_date) 
            DO UPDATE SET nav = EXCLUDED.nav
          `);
        }
        
        // Insert calculated returns
        const today = new Date().toISOString().split('T')[0];
        await client.query(`
          INSERT INTO fund_returns (
            scheme_code, return_1d, return_1w, return_1m, return_3m, return_6m, return_ytd,
            return_1y, return_2y, return_3y, return_5y, return_7y, return_10y, return_12y,
            return_since_inception, score, calculation_date, last_updated
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, CURRENT_TIMESTAMP)
          ON CONFLICT (scheme_code, calculation_date)
          DO UPDATE SET
            return_1d = EXCLUDED.return_1d,
            return_1w = EXCLUDED.return_1w,
            return_1m = EXCLUDED.return_1m,
            return_3m = EXCLUDED.return_3m,
            return_6m = EXCLUDED.return_6m,
            return_ytd = EXCLUDED.return_ytd,
            return_1y = EXCLUDED.return_1y,
            return_2y = EXCLUDED.return_2y,
            return_3y = EXCLUDED.return_3y,
            return_5y = EXCLUDED.return_5y,
            return_7y = EXCLUDED.return_7y,
            return_10y = EXCLUDED.return_10y,
            return_12y = EXCLUDED.return_12y,
            return_since_inception = EXCLUDED.return_since_inception,
            score = EXCLUDED.score,
            last_updated = CURRENT_TIMESTAMP
        `, [
          meta.scheme_code,
          returns['1D'].value,
          returns['1W'].value,
          returns['1M'].value,
          returns['3M'].value,
          returns['6M'].value,
          returns['YTD'].value,
          returns['1Y'].value,
          returns['2Y'].value,
          returns['3Y'].value,
          returns['5Y'].value,
          returns['7Y'].value,
          returns['10Y'].value,
          returns['12Y'].value,
          returns['SINCE_INCEPTION'].value,
          scoreData.score,
          today
        ]);
        
        processedCount++;
        
        // Show detailed returns for the first 3 funds and every 50th fund
        if (processedCount <= 3 || processedCount % 50 === 0) {
          console.log(`\n=== FUND ${processedCount}: ${meta.scheme_name} ===`);
          console.log(`Current NAV: ${currentNav} (${navData[0].date})`);
          console.log(`NAV History: ${navData.length} entries`);
          console.log(`Score: ${scoreData.score.toFixed(4)} (${scoreData.availablePeriods}/${scoreData.totalPeriods} periods)`);
          
          // Show key returns with NAV details
          ['1D', '1W', '1M', '3M', '6M', '1Y', '3Y', '5Y', 'SINCE_INCEPTION'].forEach(period => {
            const data = returns[period];
            if (data && data.value !== null) {
              console.log(`${period}: ${data.value.toFixed(2)}% [${data.current_nav}(${data.current_nav_date}) vs ${data.historical_nav}(${data.historical_nav_date})] Target: ${data.target_date} (from ${data.today_actual_date})`);
            }
          });
        } else {
          console.log(`Processed ${processedCount}/${validFunds.length}: ${meta.scheme_name} (${navData.length} NAVs) - Score: ${scoreData.score.toFixed(2)}`);
        }
      }
      
      // Commit batch and start new transaction
      await client.query('COMMIT');
      await client.query('BEGIN');
      
      // Short pause between batches
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    await client.query('COMMIT');
    console.log(`All ${processedCount} funds data seeded successfully with historical NAV and calculated returns`);
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error seeding funds data:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Score calculation function
function calculateOverallWeightedScore(returns) {
  const weights = {
    "1W": 0.02,  // Start small - very low, too noisy for reliability
    "1M": 0.05,  // Gradually increase - moderate, recent momentum is a factor
    "3M": 0.09,  // Continue increasing - good indicator of current trend
    "6M": 0.14,  // Further increase - important for sustained short-term performance
    "YTD": 0.07, // Calendar year performance, good contextual recent view
    "1Y": 0.20,  // PEAK - highest importance, crucial for a full market cycle
    "2Y": 0.13,  // Slight decrease - significant for medium-term consistency
    "3Y": 0.13,  // Further decrease - provides longer-term consistency check
    "5Y": 0.11,  // Continue decreasing - good for evaluating performance across market conditions
    "10Y": 0.06, // Lowest weight - essential for long-term compounding but less for "upside capture"
};
  
  let totalScore = 0;
  let totalWeightUsed = 0;
  const scoreBreakdown = {};
  
  // Calculate weighted score for each period
  Object.entries(weights).forEach(([period, weight]) => {
    const periodData = returns[period];
    
    if (periodData && periodData.value !== null && !isNaN(periodData.value)) {
      const contribution = periodData.value * weight;
      totalScore += contribution;
      totalWeightUsed += weight;
      
      scoreBreakdown[period] = {
        return: periodData.value,
        weight: weight,
        contribution: contribution
      };
    } else {
      scoreBreakdown[period] = {
        return: null,
        weight: weight,
        contribution: 0,
        reason: periodData ? periodData.reason : 'No data'
      };
    }
  });
  
  return {
    score: totalScore,
    totalWeightUsed: totalWeightUsed,
    scoreBreakdown: scoreBreakdown,
    availablePeriods: Object.keys(scoreBreakdown).filter(p => scoreBreakdown[p].contribution !== 0).length,
    totalPeriods: Object.keys(weights).length
  };
}

// Run the seeder
if (require.main === module) {
  seedDatabase()
    .then(() => {
      console.log('Seeding process completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Seeding process failed:', error);
      process.exit(1);
    });
}

module.exports = { seedDatabase, calculateReturns, calculateOverallWeightedScore };