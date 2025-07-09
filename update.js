const { Pool } = require('pg');
require('dotenv').config();

// Import service modules
const kuveraListService = require('./kuvera-list-service');
const scoringUtils = require('./scoring-utils');

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function dailyUpdate() {
  console.log('🔄 Starting MF Compass Daily Update...');
  console.log(`📅 Update timestamp: ${new Date().toISOString()}`);
  
  let totalFunds = 0;
  let updatedFunds = [];
  let skippedFunds = 0;
  let failedFunds = 0;
  
  try {
    // Phase 1: Active Fund Discovery
    console.log('\n📊 Phase 1: Active Fund Discovery');
    const activeFunds = await getActiveFundsFromDatabase();
    totalFunds = activeFunds.length;
    console.log(`✅ Found ${totalFunds} active funds in database`);
    
    // Phase 2: Data Fetching & Update Processing
    console.log('\n🔄 Phase 2: Data Fetching & Update Processing');
    const updateResults = await fetchAndUpdateLatestData(activeFunds);
    updatedFunds = updateResults.updated;
    skippedFunds = updateResults.skipped;
    failedFunds = updateResults.failed;
    
    // Phase 3A: Raw Score Calculation for Updated Funds
    if (updatedFunds.length > 0) {
      console.log('\n📈 Phase 3A: Score Calculation for Updated Funds');
      await calculateRawScoresForUpdatedFunds(updatedFunds);
      
      // Phase 3B: Category-wise Score Normalization
      console.log('\n🎯 Phase 3B: Category-wise Score Normalization');
      await normalizeAllScoresInDatabase();
    }
    
    // Summary Report
    console.log('\n📊 Daily Update Summary:');
    console.log(`  Total funds processed: ${totalFunds}`);
    console.log(`  Funds updated with new data: ${updatedFunds.length}`);
    console.log(`  Funds skipped (no new data): ${skippedFunds}`);
    console.log(`  Funds failed: ${failedFunds}`);
    console.log(`  Success rate: ${((totalFunds - failedFunds) / totalFunds * 100).toFixed(1)}%`);    
  } catch (error) {
    console.error('\n❌ Daily update failed:', error.message);
    throw error;
  } finally {
    await pool.end();
  }
}

async function getActiveFundsFromDatabase() {
  const client = await pool.connect();
  
  try {
    const result = await client.query(`
      SELECT 
        id,
        kuvera_code,
        scheme_name,
        isin,
        fund_house_name,
        fund_category,
        fund_type,
        current_nav,
        current_nav_date,
        start_date,
        last_updated
      FROM funds 
      ORDER BY scheme_name
    `);
    
    return result.rows;
    
  } catch (error) {
    console.error('❌ Error fetching active funds from database:', error.message);
    throw error;
  } finally {
    client.release();
  }
}

async function fetchAndUpdateLatestData(activeFunds) {
  const client = await pool.connect();
  const batchSize = 5;
  const delayBetweenBatches = 200; // 200 ms
  
  let updatedFunds = [];
  let skippedCount = 0;
  let failedCount = 0;
  
  try {
    console.log(`🔄 Processing ${activeFunds.length} funds in batches of ${batchSize}...`);
    
    for (let i = 0; i < activeFunds.length; i += batchSize) {
      const batch = activeFunds.slice(i, i + batchSize);
      const batchNumber = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(activeFunds.length / batchSize);
      
      console.log(`📦 Processing batch ${batchNumber}/${totalBatches}`);
      
      // Fetch data for batch concurrently
      const batchPromises = batch.map(fund => fetchLatestDataForFund(fund));
      const batchResults = await Promise.allSettled(batchPromises);
      
      // Process batch results with transaction
      await client.query('BEGIN');
      
      try {
        for (let j = 0; j < batchResults.length; j++) {
          const result = batchResults[j];
          const fund = batch[j];
          
          if (result.status === 'fulfilled' && result.value) {
            const latestData = result.value;
            
            // Check if this is actually new data by comparing NAV dates
            const currentNavDate = fund.current_nav_date;
            const newNavDate = latestData.nav?.date;
            
            // Convert dates to consistent format for comparison (YYYY-MM-DD)
            const currentDateStr = currentNavDate ? formatDateForComparison(currentNavDate) : null;
            const newDateStr = newNavDate ? formatDateForComparison(newNavDate) : null;
            
            // Skip update if NAV dates are the same (no new data)
            if (currentDateStr && newDateStr && currentDateStr === newDateStr) {
              skippedCount++;
            } else if (!currentDateStr || !newDateStr || newDateStr > currentDateStr) {
              // Update fund data only if we have newer data
              await updateFundData(client, fund, latestData);
              updatedFunds.push(fund);
              
              console.log(`✓ ${fund.scheme_name} - NAV: ${latestData.nav.nav} (${latestData.nav.date})`);
            } else {
              skippedCount++;
            }
          } else if (result.status === 'rejected') {
            console.warn(`✗ ${fund.scheme_name}: ${result.reason?.message}`);
            failedCount++;
          }
        }
        
        await client.query('COMMIT');        
      } catch (error) {
        await client.query('ROLLBACK');
        console.error(`❌ Error processing batch ${batchNumber}:`, error.message);
        failedCount += batch.length;
      }
      
      // Add delay between batches (except for last batch)
      if (i + batchSize < activeFunds.length) {
        await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
      }
    }
    
    return {
      updated: updatedFunds,
      skipped: skippedCount,
      failed: failedCount
    };
    
  } catch (error) {
    console.error('❌ Error during data fetching and update:', error.message);
    throw error;
  } finally {
    client.release();
  }
}

async function fetchLatestDataForFund(fund) {
  try {
    // Use Kuvera code directly
    const fundData = await kuveraListService.getFundDetails(fund.kuvera_code);
    
    if (!fundData) {
      throw new Error(`No data returned for Kuvera code: ${fund.kuvera_code}`);
    }
    
    // Calculate 1D returns if both current and last NAV are available
    let calculatedReturns1d = null;
    if (fundData.nav && fundData.last_nav) {
      const currentNav = parseFloat(fundData.nav.nav);
      const lastNav = parseFloat(fundData.last_nav.nav);
      calculatedReturns1d = ((currentNav - lastNav) / lastNav) * 100;
    }
    
    return {
      ...fundData,
      calculatedReturns1d
    };
    
  } catch (error) {
    throw new Error(`Failed to fetch data for ${fund.kuvera_code}: ${error.message}`);
  }
}

async function updateFundData(client, fund, latestData) {
  try {
    // Parse NAV data
    const currentNav = latestData.nav ? parseFloat(latestData.nav.nav) : null;
    const currentNavDate = latestData.nav ? latestData.nav.date : null;
    const t1Nav = latestData.last_nav ? parseFloat(latestData.last_nav.nav) : null;
    const t1NavDate = latestData.last_nav ? latestData.last_nav.date : null;
    
    // Parse returns data
    const returns1d = latestData.calculatedReturns1d;
    const returns1w = latestData.returns ? latestData.returns.week_1 : null;
    const returns1y = latestData.returns ? latestData.returns.year_1 : null;
    const returns3y = latestData.returns ? latestData.returns.year_3 : null;
    const returns5y = latestData.returns ? latestData.returns.year_5 : null;
    const returnsInception = latestData.returns ? latestData.returns.inception : null;
    const returnsDate = latestData.returns ? latestData.returns.date : null;
    
    // Parse fund metadata
    const expenseRatio = latestData.expense_ratio ? parseFloat(latestData.expense_ratio) : null;
    const expenseRatioDate = latestData.expense_ratio_date ? latestData.expense_ratio_date : null;
    const volatility = latestData.volatility ? parseFloat(latestData.volatility) : null;
    const portfolioTurnover = latestData.portfolio_turnover ? parseFloat(latestData.portfolio_turnover) : null;
    const aumInCrores = latestData.aum ? latestData.aum / 10 : null;
    const fundRating = latestData.fund_rating ? parseInt(latestData.fund_rating) : null;
    const fundRatingDate = latestData.fund_rating_date ? latestData.fund_rating_date : null;
    
    // Process fund managers - convert semicolon-separated string to JSON array
    let fundManagers = null;
    if (latestData.fund_manager && typeof latestData.fund_manager === 'string') {
      const managerNames = latestData.fund_manager
        .split(';')
        .map(name => name.trim())
        .filter(name => name.length > 0);
      
      fundManagers = managerNames.length > 0 ? JSON.stringify(managerNames) : null;
    }
    
    // Update fund in database
    await client.query(`
      UPDATE funds SET
        current_nav = $1,
        current_nav_date = $2,
        t1_nav = $3,
        t1_nav_date = $4,
        returns_1d = $5,
        returns_1w = $6,
        returns_1y = $7,
        returns_3y = $8,
        returns_5y = $9,
        returns_inception = $10,
        returns_date = $11,
        expense_ratio = $12,
        expense_ratio_date = $13,
        fund_managers = $14,
        volatility = $15,
        portfolio_turnover = $16,
        aum = $17,
        fund_rating = $18,
        fund_rating_date = $19,
        crisil_rating = $20,
        last_updated = CURRENT_TIMESTAMP
      WHERE kuvera_code = $21
    `, [
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
      expenseRatio,
      expenseRatioDate,
      fundManagers,
      volatility,
      portfolioTurnover,
      aumInCrores,
      fundRating,
      fundRatingDate,
      latestData.crisil_rating,
      fund.kuvera_code
    ]);
    
  } catch (error) {
    console.error(`❌ Error updating fund data for ${fund.scheme_name}:`, error.message);
    throw error;
  }
}

async function calculateRawScoresForUpdatedFunds(updatedFunds) {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    console.log(`📊 Calculating raw scores for ${updatedFunds.length} updated funds...`);
    
    for (const fund of updatedFunds) {
      try {
        // Get the latest fund data from database for proper scoring
        const fundDataResult = await client.query(`
          SELECT 
            returns_1y, returns_3y, returns_5y, returns_1w, returns_inception,
            fund_rating, volatility, aum, start_date
          FROM funds 
          WHERE kuvera_code = $1
        `, [fund.kuvera_code]);
        
        if (fundDataResult.rows.length > 0) {
          const fundData = fundDataResult.rows[0];
          
          // Calculate fund score using the same logic as seed
          const fundDataForScoring = {
            returns_1y: fundData.returns_1y,
            returns_3y: fundData.returns_3y,
            returns_5y: fundData.returns_5y,
            returns_1w: fundData.returns_1w,
            returns_inception: fundData.returns_inception,
            fund_rating: fundData.fund_rating,
            volatility: fundData.volatility,
            aum: fundData.aum,
            start_date: fundData.start_date
          };
          
          const scoreResult = scoringUtils.calculateFundScore(fundDataForScoring);
          
          // Update fund score in database (raw score, not normalized yet)
          await client.query(`
            UPDATE funds SET
              total_score = $1,
              score_updated = CURRENT_TIMESTAMP,
              last_updated = CURRENT_TIMESTAMP
            WHERE kuvera_code = $2
          `, [scoreResult.total_score, fund.kuvera_code]);
          
          console.log(`  ✓ Score calculated for ${fund.scheme_name}: ${scoreResult.total_score.toFixed(2)}`);
        }
      } catch (error) {
        console.error(`❌ Error calculating score for ${fund.scheme_name}:`, error.message);
      }
    }
    
    await client.query('COMMIT');
    console.log(`✅ Raw scores calculated for ${updatedFunds.length} funds`);
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error calculating raw scores:', error.message);
    throw error;
  } finally {
    client.release();
  }
}

async function normalizeAllScoresInDatabase() {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Fetch all funds with their scores, categories and fund types
    const result = await client.query(`
      SELECT id, kuvera_code, scheme_name, fund_category, fund_type, total_score
      FROM funds
      WHERE total_score IS NOT NULL
      ORDER BY fund_type, fund_category, total_score DESC
    `);
    
    const fundsWithScores = result.rows;
    console.log(`📊 Normalizing scores for ${fundsWithScores.length} funds...`);
    
    // Use scoring utils to normalize all scores
    const normalizedFunds = scoringUtils.normalizeFundScores(fundsWithScores);
    
    // Update the database with normalized scores
    for (const fund of normalizedFunds) {
      await client.query(`
        UPDATE funds 
        SET total_score = $1, score_updated = CURRENT_TIMESTAMP
        WHERE id = $2
      `, [fund.total_score, fund.id]);
    }
    
    await client.query('COMMIT');
    
    // Generate and display category statistics
    const categoryStats = scoringUtils.getCategoryStatistics(normalizedFunds);
    
    console.log('✅ Score normalization completed');
    console.log('\n📊 Updated category-wise score statistics:');
    Object.entries(categoryStats).forEach(([category, stats]) => {
      console.log(`  ${category}:`);
      console.log(`    Count: ${stats.count}`);
      console.log(`    Avg Score: ${stats.avgScore}`);
      console.log(`    Range: ${stats.minScore} - ${stats.maxScore}`);
    });
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error normalizing scores:', error.message);
    throw error;
  } finally {
    client.release();
  }
}

// Helper function to format dates consistently for comparison
function formatDateForComparison(date) {
  if (!date) return null;
  
  // If it's already a string in YYYY-MM-DD format, return as is
  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return date;
  }
  
  // If it's a Date object or string, convert to YYYY-MM-DD
  const dateObj = new Date(date);
  if (isNaN(dateObj.getTime())) {
    return null;
  }
  
  // Use local time methods instead of UTC to handle IST properly
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  
  return `${year}-${month}-${day}`;
}

// Run the daily updater
if (require.main === module) {
  dailyUpdate()
    .then(() => {
      console.log('\n✅ Daily update process completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Daily update process failed:', error);
      process.exit(1);
    });
}

module.exports = { dailyUpdate };