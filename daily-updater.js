const axios = require('axios');
const { Pool } = require('pg');
require('dotenv').config();

// Import calculation functions from seeder
const { calculateReturns, calculateOverallWeightedScore } = require('./seeder');

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// API configuration
const MF_API_BASE_URL = process.env.MF_API_BASE_URL || 'https://api.mfapi.in';

async function dailyUpdate() {
  console.log('Starting MF Compass daily update...');
  console.log(`Update date: ${new Date().toISOString()}`);
  
  try {
    // Step 1: Get all active funds from database
    console.log('Step 1: Fetching active funds from database...');
    const activeFunds = await getActiveFunds();
    console.log(`Found ${activeFunds.length} active funds to update`);
    
    // Step 2: Fetch latest NAVs and update nav_history
    console.log('Step 2: Fetching latest NAVs and updating nav_history...');
    const updatedFunds = await fetchAndUpdateLatestNavs(activeFunds);
    console.log(`Updated NAVs for ${updatedFunds.length} funds`);
    
    // Step 3: Recalculate returns and scores for updated funds
    console.log('Step 3: Recalculating returns and scores...');
    await recalculateReturnsAndScores(updatedFunds);
    
    console.log('Daily update completed successfully!');
    
  } catch (error) {
    console.error('Error during daily update:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

async function getActiveFunds() {
  const client = await pool.connect();
  
  try {
    const result = await client.query(`
      SELECT 
        scheme_code, 
        scheme_name, 
        fund_house, 
        scheme_category,
        current_nav,
        last_updated
      FROM funds 
      ORDER BY scheme_code
    `);
    
    return result.rows;
    
  } catch (error) {
    console.error('Error fetching active funds:', error);
    throw error;
  } finally {
    client.release();
  }
}

async function fetchAndUpdateLatestNavs(activeFunds) {
  const client = await pool.connect();
  const updatedFunds = [];
  const batchSize = 10;
  
  try {
    await client.query('BEGIN');
    
    for (let i = 0; i < activeFunds.length; i += batchSize) {
      const batch = activeFunds.slice(i, i + batchSize);
      const batchPromises = batch.map(fund => fetchLatestNavForFund(fund));
      
      try {
        const batchResults = await Promise.allSettled(batchPromises);
        
        for (let j = 0; j < batchResults.length; j++) {
          const result = batchResults[j];
          const fund = batch[j];
          
          if (result.status === 'fulfilled' && result.value) {
            const latestNavData = result.value;
            
            // Check if this NAV date already exists in database
            const existingNav = await client.query(`
              SELECT nav_date FROM nav_history 
              WHERE scheme_code = $1 AND nav_date = $2
            `, [fund.scheme_code, latestNavData.date]);
            
            if (existingNav.rows.length === 0) {
              // Insert new NAV data
              await client.query(`
                INSERT INTO nav_history (scheme_code, nav_date, nav)
                VALUES ($1, $2, $3)
              `, [fund.scheme_code, latestNavData.date, latestNavData.nav]);
              
              // Update current_nav in funds table
              await client.query(`
                UPDATE funds 
                SET current_nav = $1, last_updated = CURRENT_TIMESTAMP
                WHERE scheme_code = $2
              `, [latestNavData.nav, fund.scheme_code]);
              
              updatedFunds.push({
                ...fund,
                latest_nav: latestNavData.nav,
                latest_nav_date: latestNavData.date
              });
              
              console.log(`✓ Updated NAV for ${fund.scheme_name}: ${latestNavData.nav} (${latestNavData.date})`);
            } else {
              console.log(`→ NAV already exists for ${fund.scheme_name} on ${latestNavData.date}`);
            }
          } else if (result.status === 'rejected') {
            console.warn(`✗ Failed to fetch NAV for ${fund.scheme_name} (${fund.scheme_code}):`, result.reason?.message);
          }
        }
        
        // Commit batch
        await client.query('COMMIT');
        await client.query('BEGIN');
        
        // Progress update
        console.log(`Processed NAV batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(activeFunds.length / batchSize)}`);
        
        // Small delay between batches
        if (i + batchSize < activeFunds.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        
      } catch (error) {
        console.error(`Error processing NAV batch starting at index ${i}:`, error);
        await client.query('ROLLBACK');
        await client.query('BEGIN');
      }
    }
    
    await client.query('COMMIT');
    return updatedFunds;
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error updating NAVs:', error);
    throw error;
  } finally {
    client.release();
  }
}

async function fetchLatestNavForFund(fund) {
  try {
    const response = await axios.get(`${MF_API_BASE_URL}/mf/${fund.scheme_code}/latest`);
    const data = response.data;
    
    if (data.status !== 'SUCCESS' || !data.data || data.data.length === 0) {
      throw new Error(`Invalid API response for scheme ${fund.scheme_code}`);
    }
    
    const latestNav = data.data[0];
    
    return {
      date: convertDateFormat(latestNav.date),
      nav: parseFloat(latestNav.nav)
    };
    
  } catch (error) {
    throw new Error(`Failed to fetch latest NAV for ${fund.scheme_code}: ${error.message}`);
  }
}

async function recalculateReturnsAndScores(updatedFunds) {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    for (const fund of updatedFunds) {
      // Get complete NAV history for this fund
      const navHistory = await client.query(`
        SELECT nav_date, nav FROM nav_history 
        WHERE scheme_code = $1 
        ORDER BY nav_date DESC
      `, [fund.scheme_code]);
      
      if (navHistory.rows.length === 0) {
        console.warn(`No NAV history found for ${fund.scheme_name}`);
        continue;
      }
      
      // Convert database date format to API format for calculation compatibility
      const navData = navHistory.rows.map(row => ({
        date: convertDateToApiFormat(row.nav_date),
        nav: row.nav.toString()
      }));
      
      // Calculate returns using the same function as seeder
      const returns = calculateReturns(navData);
      
      // Calculate weighted score
      const scoreData = calculateOverallWeightedScore(returns);
      
      // Update fund_returns table
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
        fund.scheme_code,
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
      
      console.log(`✓ Updated returns for ${fund.scheme_name} - Score: ${scoreData.score.toFixed(4)}`);
      
      // Show key returns for monitoring
      const keyReturns = ['1D', '1W', '1M', '6M', '1Y', '3Y'];
      const returnsSummary = keyReturns
        .filter(period => returns[period].value !== null)
        .map(period => `${period}: ${returns[period].value.toFixed(2)}%`)
        .join(', ');
      
      if (returnsSummary) {
        console.log(`  Returns: ${returnsSummary}`);
      }
    }
    
    await client.query('COMMIT');
    console.log(`Returns and scores updated for ${updatedFunds.length} funds`);
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error recalculating returns and scores:', error);
    throw error;
  } finally {
    client.release();
  }
}

function convertDateFormat(dateString) {
  // Convert from DD-MM-YYYY to YYYY-MM-DD
  const parts = dateString.split('-');
  return `${parts[2]}-${parts[1]}-${parts[0]}`;
}

function convertDateToApiFormat(dateObject) {
  // Convert from YYYY-MM-DD (Date object) to DD-MM-YYYY (API format)
  const date = new Date(dateObject);
  const day = date.getDate().toString().padStart(2, '0');
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const year = date.getFullYear();
  return `${day}-${month}-${year}`;
}

// Run the daily updater
if (require.main === module) {
  dailyUpdate()
    .then(() => {
      console.log('Daily update process completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Daily update process failed:', error);
      process.exit(1);
    });
}

module.exports = { dailyUpdate };