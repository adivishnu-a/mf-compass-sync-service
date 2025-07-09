const axios = require('axios');

class KuveraListService {
  constructor() {
    this.listApiUrl = 'https://api.kuvera.in/mf/api/v4/fund_schemes/list.json';
    this.detailsApiUrl = 'https://api.kuvera.in/mf/api/v5/fund_schemes';
    this.timeout = 15000;
    this.headers = {
      'Accept': 'application/json',
      'User-Agent': 'MF-Compass-Sync-Service/2.0'
    };
    
    // Allowed fund categories configuration
    this.allowedCategories = {
      'Equity': [
        'Large Cap Fund',
        'Mid Cap Fund',
        'Small Cap Fund',
        'Flexi Cap Fund',
        'ELSS'
      ],
      'Hybrid': [
        'Aggressive Hybrid Fund',
        'Dynamic Asset Allocation or Balanced Advantage',
        'Multi Asset Allocation'
      ]
    };
  }

  async testConnection() {
    try {
      const response = await axios.get(this.listApiUrl, {
        timeout: this.timeout,
        headers: this.headers
      });
      
      if (response.status === 200 && response.data) {
        const data = response.data;
        
        // Validate response structure
        const hasEquity = data.Equity && typeof data.Equity === 'object';
        const hasHybrid = data.Hybrid && typeof data.Hybrid === 'object';
        
        if (hasEquity && hasHybrid) {
          return true;
        } else {
          throw new Error('Expected asset classes (Equity/Hybrid) not found in API response');
        }
      }
      
      throw new Error('Invalid API response');
      
    } catch (error) {
      console.error('❌ Kuvera API connection test failed:', error.message);
      throw error;
    }
  }

  async getFilteredFundCodes() {
    try {
      const response = await axios.get(this.listApiUrl, {
        timeout: this.timeout,
        headers: this.headers
      });
      
      if (!response.data) {
        throw new Error('No data received from API');
      }
      
      const data = response.data;
      const filteredFunds = [];
      
      // Process each asset class
      for (const [assetClass, categories] of Object.entries(this.allowedCategories)) {
        if (!data[assetClass]) {
          continue;
        }
        
        // Process each allowed category
        for (const category of categories) {
          if (!data[assetClass][category]) {
            continue;
          }
          
          // Process each fund house in the category
          for (const [fundHouse, funds] of Object.entries(data[assetClass][category])) {
            if (!Array.isArray(funds)) {
              continue;
            }
            
            // Filter for growth plans (-GR suffix)
            const growthFunds = funds.filter(fund => {
              const hasCode = fund.c && typeof fund.c === 'string';
              const isGrowth = hasCode && fund.c.endsWith('-GR');
              // Accept both 'Y' and 'Z' for reinvestment flag - 'Z' seems to be the standard for growth funds
              const hasReinvestment = fund.re === 'Y' || fund.re === 'Z';
              
              return hasCode && isGrowth && hasReinvestment;
            });
            
            // Add filtered funds to result
            growthFunds.forEach(fund => {
              filteredFunds.push({
                code: fund.c,
                name: fund.n,
                assetClass: assetClass,
                category: category,
                fundHouse: fundHouse,
                nav: fund.v,
                reinvestment: fund.re
              });
            });
          }
        }
      }
      
      return filteredFunds;
      
    } catch (error) {
      console.error('❌ Failed to fetch filtered fund codes:', error.message);
      throw error;
    }
  }

  async getFundDetails(fundCode) {
    try {
      const url = `${this.detailsApiUrl}/${fundCode}.json`;
      
      const response = await axios.get(url, {
        timeout: this.timeout,
        headers: this.headers
      });
      
      if (!response.data || !Array.isArray(response.data) || response.data.length === 0) {
        throw new Error(`No fund details found for code: ${fundCode}`);
      }
      
      // API returns array, take first element
      const fundDetails = response.data[0];
      
      // Validate essential fields
      if (!fundDetails.code || !fundDetails.name) {
        throw new Error(`Invalid fund details structure for code: ${fundCode}`);
      }
      
      return fundDetails;
      
    } catch (error) {
      console.error(`❌ Failed to fetch fund details for ${fundCode}:`, error.message);
      throw error;
    }
  }

  async getFundDetailsBatch(fundCodes, batchSize = 5, delayMs = 200) {
    const results = [];
    
    for (let i = 0; i < fundCodes.length; i += batchSize) {
      const batch = fundCodes.slice(i, i + batchSize);
      
      const batchPromises = batch.map(fundCode => 
        this.getFundDetails(fundCode.code || fundCode)
          .then(data => ({ success: true, data, fundCode: fundCode.code || fundCode }))
          .catch(error => ({ success: false, error: error.message, fundCode: fundCode.code || fundCode }))
      );
      
      const batchResults = await Promise.allSettled(batchPromises);
      
      // Process batch results
      batchResults.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          results.push({
            success: false,
            error: result.reason.message,
            fundCode: batch[index].code || batch[index]
          });
        }
      });
      
      // Add delay between batches (except for last batch)
      if (i + batchSize < fundCodes.length) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
    
    return results;
  }

  // Helper method to get fund categories breakdown
  getCategoriesBreakdown(fundCodes) {
    const breakdown = {};
    
    fundCodes.forEach(fund => {
      const key = `${fund.assetClass} - ${fund.category}`;
      breakdown[key] = (breakdown[key] || 0) + 1;
    });
    
    return breakdown;
  }

  // Helper method to validate fund data structure
  validateFundData(fundData) {
    const requiredFields = ['code', 'name', 'ISIN', 'fund_house', 'fund_category'];
    const missingFields = requiredFields.filter(field => !fundData[field]);
    
    if (missingFields.length > 0) {
      return {
        isValid: false,
        missingFields: missingFields,
        message: `Missing required fields: ${missingFields.join(', ')}`
      };
    }
    
    // Validate NAV data
    if (!fundData.nav || !fundData.nav.nav) {
      return {
        isValid: false,
        message: 'NAV data is missing or invalid'
      };
    }
    
    // Validate numeric fields
    const nav = parseFloat(fundData.nav.nav);
    if (isNaN(nav) || nav <= 0) {
      return {
        isValid: false,
        message: 'Invalid NAV value'
      };
    }
    
    return {
      isValid: true,
      message: 'Fund data validation passed'
    };
  }
}

module.exports = new KuveraListService();