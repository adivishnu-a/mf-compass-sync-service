const { Pool } = require('pg');
require('dotenv').config();

// Import service modules
const kuveraListService = require('./kuvera-list-service');

async function testConnection() {
  console.log('🔧 MF Compass System Test & Validation\n');
  
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });

  try {
    // Test 1: Database Connection
    await testDatabaseConnection(pool);
    
    // Test 2: Kuvera API
    await testKuveraAPI();
    
    // Test 3: Fund Discovery
    await testFundDiscovery();
    
    // Test 4: Data Quality
    await testDataQuality();
    
    console.log('\n✅ All tests passed successfully!');
    console.log('🚀 System is ready for operation');
    
  } catch (error) {
    console.error('\n❌ System test failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

async function testDatabaseConnection(pool) {
  try {
    console.log('🗄️ Testing database connection...');
    const client = await pool.connect();
    
    const result = await client.query('SELECT NOW() as current_time');
    console.log('✅ Database connection successful');
    console.log(`📅 Server time: ${result.rows[0].current_time}`);
    
    client.release();
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    console.error('💡 Please check your DATABASE_URL in .env file');
    throw error;
  }
}

async function testKuveraAPI() {
  try {
    console.log('\n🌐 Testing Kuvera API...');
    const testResult = await kuveraListService.testConnection();
    
    if (testResult) {
      console.log('✅ Kuvera API connection successful');
    }
  } catch (error) {
    console.error('❌ Kuvera API test failed:', error.message);
    throw error;
  }
}

async function testFundDiscovery() {
  try {
    console.log('\n📊 Testing fund discovery...');
    const sampleCodes = await kuveraListService.getFilteredFundCodes();
    
    if (sampleCodes.length === 0) {
      throw new Error('No funds discovered');
    }
    
    console.log(`✅ Found ${sampleCodes.length} eligible funds`);
    
    // Show category breakdown
    const breakdown = kuveraListService.getCategoriesBreakdown(sampleCodes);
    console.log('\n📈 Category breakdown:');
    Object.entries(breakdown).forEach(([category, count]) => {
      console.log(`  ${category}: ${count} funds`);
    });
    
  } catch (error) {
    console.error('❌ Fund discovery test failed:', error.message);
    throw error;
  }
}

async function testDataQuality() {
  try {
    console.log('\n🔍 Testing data quality...');
    const sampleCodes = await kuveraListService.getFilteredFundCodes();
    
    if (sampleCodes.length === 0) {
      throw new Error('No sample funds available for testing');
    }
    
    // Test sample fund details
    const sampleFund = sampleCodes[0];
    console.log(`📄 Testing fund: ${sampleFund.code}`);
    
    const fundDetails = await kuveraListService.getFundDetails(sampleFund.code);
    
    // Validate data quality
    const validation = kuveraListService.validateFundData(fundDetails);
    
    if (!validation.isValid) {
      throw new Error(`Data validation failed: ${validation.message}`);
    }
    
    console.log('   Sample fund data quality verified ✅');
    console.log(`   Fund:\t${fundDetails.name}`);
    console.log(`   NAV:\t₹${fundDetails.nav?.nav || 'N/A'}`);
    console.log(`   Date:\t${fundDetails.nav?.date || 'N/A'}`);
    console.log(`   AUM:\t₹${fundDetails.aum ? (fundDetails.aum / 10).toFixed(1) : 'N/A'} cr`);
    console.log(`   Rating:\t${fundDetails.fund_rating || 'N/A'}`);
    
  } catch (error) {
    console.error('❌ Data quality test failed:', error.message);
    throw error;
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  testConnection();
}

module.exports = { testConnection };