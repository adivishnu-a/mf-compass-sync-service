const { Pool } = require('pg');
require('dotenv').config();

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function flushDatabase() {
  console.log('🗑️  Starting database flush operation...');
  console.log('⚠️  WARNING: This will completely delete ALL data and tables!');
  
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    console.log('Step 1: Dropping all tables...');
    
    // Drop tables in correct order (child tables first due to foreign key constraints)
    await client.query('DROP TABLE IF EXISTS fund_returns CASCADE');
    console.log('  ✅ Dropped fund_returns table');
    
    await client.query('DROP TABLE IF EXISTS nav_history CASCADE');
    console.log('  ✅ Dropped nav_history table');
    
    await client.query('DROP TABLE IF EXISTS funds CASCADE');
    console.log('  ✅ Dropped funds table');
    
    console.log('Step 2: Dropping all indexes (if any remain)...');
    
    // Drop any remaining indexes that might exist
    const indexQueries = [
      'DROP INDEX IF EXISTS idx_funds_scheme_code CASCADE',
      'DROP INDEX IF EXISTS idx_funds_category CASCADE',
      'DROP INDEX IF EXISTS idx_funds_fund_house CASCADE',
      'DROP INDEX IF EXISTS idx_nav_history_scheme_code CASCADE',
      'DROP INDEX IF EXISTS idx_nav_history_date CASCADE',
      'DROP INDEX IF EXISTS idx_nav_history_scheme_date CASCADE',
      'DROP INDEX IF EXISTS idx_fund_returns_scheme_code CASCADE',
      'DROP INDEX IF EXISTS idx_fund_returns_calculation_date CASCADE'
    ];
    
    for (const query of indexQueries) {
      try {
        await client.query(query);
      } catch (error) {
        // Ignore errors for non-existent indexes
      }
    }
    console.log('  ✅ Cleaned up any remaining indexes');
    
    console.log('Step 3: Dropping all sequences (if any)...');
    
    // Drop sequences that were auto-created with SERIAL columns
    const sequenceQueries = [
      'DROP SEQUENCE IF EXISTS fund_returns_id_seq CASCADE',
      'DROP SEQUENCE IF EXISTS nav_history_id_seq CASCADE',
      'DROP SEQUENCE IF EXISTS funds_id_seq CASCADE'
    ];
    
    for (const query of sequenceQueries) {
      try {
        await client.query(query);
      } catch (error) {
        // Ignore errors for non-existent sequences
      }
    }
    console.log('  ✅ Cleaned up auto-generated sequences');
    
    console.log('Step 4: Dropping any custom types or schemas (if any)...');
    
    // Get list of all custom schemas (excluding system schemas)
    const schemaResult = await client.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name NOT IN ('information_schema', 'pg_catalog', 'pg_toast', 'public')
    `);
    
    if (schemaResult.rows.length > 0) {
      for (const row of schemaResult.rows) {
        await client.query(`DROP SCHEMA IF EXISTS ${row.schema_name} CASCADE`);
        console.log(`  ✅ Dropped custom schema: ${row.schema_name}`);
      }
    } else {
      console.log('  ✅ No custom schemas found');
    }
    
    console.log('Step 5: Cleaning up any remaining objects...');
    
    // Get list of all remaining tables in public schema
    const remainingTablesResult = await client.query(`
      SELECT tablename 
      FROM pg_tables 
      WHERE schemaname = 'public'
    `);
    
    if (remainingTablesResult.rows.length > 0) {
      console.log('  ⚠️  Found remaining tables:');
      for (const row of remainingTablesResult.rows) {
        await client.query(`DROP TABLE IF EXISTS ${row.tablename} CASCADE`);
        console.log(`    ✅ Dropped remaining table: ${row.tablename}`);
      }
    } else {
      console.log('  ✅ No remaining tables found');
    }
    
    // Get list of all remaining functions
    const functionsResult = await client.query(`
      SELECT routine_name, routine_type
      FROM information_schema.routines 
      WHERE routine_schema = 'public'
    `);
    
    if (functionsResult.rows.length > 0) {
      console.log('  ⚠️  Found custom functions/procedures:');
      for (const row of functionsResult.rows) {
        try {
          await client.query(`DROP ${row.routine_type} IF EXISTS ${row.routine_name} CASCADE`);
          console.log(`    ✅ Dropped ${row.routine_type}: ${row.routine_name}`);
        } catch (error) {
          console.log(`    ⚠️  Could not drop ${row.routine_type}: ${row.routine_name}`);
        }
      }
    } else {
      console.log('  ✅ No custom functions found');
    }
    
    await client.query('COMMIT');
    
    console.log('\n🎉 Database flush completed successfully!');
    console.log('📊 Summary:');
    console.log('  • All MF Compass tables deleted');
    console.log('  • All indexes removed');
    console.log('  • All sequences cleaned up');
    console.log('  • All custom schemas removed');
    console.log('  • Database is now completely clean');
    console.log('\n💡 You can now run the seeder to recreate the database structure:');
    console.log('   npm run seed');
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error during database flush:', error);
    throw error;
  } finally {
    client.release();
  }
}

async function confirmFlush() {
  console.log('\n🚨 DATABASE FLUSH CONFIRMATION 🚨');
  console.log('=====================================');
  console.log('This operation will:');
  console.log('• Delete ALL tables (funds, nav_history, fund_returns)');
  console.log('• Remove ALL data permanently');
  console.log('• Drop ALL indexes and sequences');
  console.log('• Clean up ALL custom schemas');
  console.log('• This action CANNOT be undone!');
  console.log('=====================================');
  
  // Since this is a utility script, we'll proceed directly
  // In a production environment, you might want to add interactive confirmation
  console.log('⏳ Proceeding with database flush in 3 seconds...');
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  return true;
}

// Main execution
async function main() {
  try {
    console.log('🔧 MF Compass Database Flush Utility');
    console.log('====================================');
    
    const confirmed = await confirmFlush();
    
    if (confirmed) {
      await flushDatabase();
    } else {
      console.log('❌ Database flush cancelled');
    }
    
  } catch (error) {
    console.error('💥 Database flush failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run the flush utility
if (require.main === module) {
  main()
    .then(() => {
      console.log('\n✅ Database flush utility completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Database flush utility failed:', error);
      process.exit(1);
    });
}

module.exports = { flushDatabase };