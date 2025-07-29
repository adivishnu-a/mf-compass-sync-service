/**
 * MF Compass Scoring System
 * Calculates weighted outperformance scores for mutual funds based on category relative performance
 * Implements category-wise normalization for fair comparison
 */

class ScoringUtils {
  constructor() {
    // Base weights for different return periods
    this.baseWeights = {
      returns_1y: 0.3499,   // ~35% - Most important (full market cycle)
      returns_3y: 0.3999,   // ~40% - Medium-term consistency
      returns_5y: 0.2499,   // ~25% - Long-term performance
      returns_1w: 0.0003    // Neglible but included - Recent momentum (minimal weight)
    };
  }

  /**
   * Calculate raw score for a single fund based on weighted outperformance over category averages
   * @param {Object} fundData - Fund data object with return fields
   * @param {Object} categoryAverages - Category averages data
   * @returns {Object} - Score calculation result
   */
  calculateFundScore(fundData, categoryAverages = null) {
    try {
      const rawScore = this.calculateRawScore(fundData, categoryAverages);
      
      return {
        total_score: Math.round(rawScore * 100) / 100, // Round to 2 decimal places
        calculation_date: new Date().toISOString(),
        score_components: this.getScoreComponents(fundData, categoryAverages)
      };
    } catch (error) {
      console.error('Error calculating fund score:', error);
      return {
        total_score: 0,
        calculation_date: new Date().toISOString(),
        error: error.message
      };
    }
  }

  /**
   * Calculate raw weighted score based on outperformance over category averages
   * @param {Object} fundData - Fund data with return fields
   * @param {Object} categoryAverages - Category averages data
   * @returns {number} - Raw weighted outperformance score
   */
  calculateRawScore(fundData, categoryAverages = null) {
    const { returns_1y, returns_3y, returns_5y, returns_1w, fund_category, fund_type } = fundData;
    
    // If no category averages provided, fall back to absolute returns (backward compatibility)
    if (!categoryAverages) {
      return this.calculateAbsoluteReturnsScore(fundData);
    }
    
    // Determine which category to compare against
    let categoryName;
    if (fund_type && fund_type.toLowerCase().includes('equity')) {
      categoryName = fund_category; // Use fund_category for equity funds
    } else {
      categoryName = fund_category; // Default to fund_category for other funds
    }
    
    // Find matching category averages
    const categoryAvg = categoryAverages[categoryName];
    if (!categoryAvg) {
      console.warn(`No category averages found for ${categoryName}, falling back to absolute returns`);
      return this.calculateAbsoluteReturnsScore(fundData);
    }
    
    // Calculate adjusted weights based on available data
    let totalAvailableWeight = 0;
    const outperformanceReturns = {};
    
    // Calculate outperformance for each return period with sign-aware logic
    function robustOutperformance(fund, cat) {
      if (cat === null || cat === undefined || isNaN(cat)) return 0;
      const denom = Math.max(Math.abs(cat), 1);
      const outperf = (fund - cat) / denom;
      if (fund < 0) {
        // Penalize negative fund returns more strongly
        const penaltyFactor = 1.5; // Increase for stronger penalty
        return outperf * penaltyFactor;
      }
      return outperf;
    }
    
    // Calculate outperformance for each return period
    if (returns_1y !== null && returns_1y !== undefined && !isNaN(returns_1y) && 
        categoryAvg.returns_1y !== null && categoryAvg.returns_1y !== undefined && !isNaN(categoryAvg.returns_1y)) {
      outperformanceReturns.returns_1y = robustOutperformance(parseFloat(returns_1y), parseFloat(categoryAvg.returns_1y));
      totalAvailableWeight += this.baseWeights.returns_1y;
    }
    
    if (returns_3y !== null && returns_3y !== undefined && !isNaN(returns_3y) && 
        categoryAvg.returns_3y !== null && categoryAvg.returns_3y !== undefined && !isNaN(categoryAvg.returns_3y)) {
      outperformanceReturns.returns_3y = robustOutperformance(parseFloat(returns_3y), parseFloat(categoryAvg.returns_3y));
      totalAvailableWeight += this.baseWeights.returns_3y;
    }
    
    if (returns_5y !== null && returns_5y !== undefined && !isNaN(returns_5y) && 
        categoryAvg.returns_5y !== null && categoryAvg.returns_5y !== undefined && !isNaN(categoryAvg.returns_5y)) {
      outperformanceReturns.returns_5y = robustOutperformance(parseFloat(returns_5y), parseFloat(categoryAvg.returns_5y));
      totalAvailableWeight += this.baseWeights.returns_5y;
    }
    
    if (returns_1w !== null && returns_1w !== undefined && !isNaN(returns_1w) && 
        categoryAvg.returns_1w !== null && categoryAvg.returns_1w !== undefined && !isNaN(categoryAvg.returns_1w)) {
      outperformanceReturns.returns_1w = robustOutperformance(parseFloat(returns_1w), parseFloat(categoryAvg.returns_1w));
      totalAvailableWeight += this.baseWeights.returns_1w;
    }
    
    // If no outperformance data available, return 0
    if (totalAvailableWeight === 0) {
      return 0;
    }
    
    // Calculate weighted outperformance score with normalized weights
    let totalScore = 0;
    Object.keys(outperformanceReturns).forEach(key => {
      const adjustedWeight = this.baseWeights[key] / totalAvailableWeight;
      totalScore += outperformanceReturns[key] * adjustedWeight;
    });
    
    return totalScore;
  }

  /**
   * Fallback method for absolute returns scoring (backward compatibility)
   * @param {Object} fundData - Fund data with return fields
   * @returns {number} - Raw weighted score based on absolute returns
   */
  calculateAbsoluteReturnsScore(fundData) {
    const { returns_1y, returns_3y, returns_5y, returns_1w } = fundData;
    
    // Calculate adjusted weights based on available data
    let totalAvailableWeight = 0;
    const availableReturns = {};
    
    // Check each return period for data availability
    if (returns_1y !== null && returns_1y !== undefined && !isNaN(returns_1y)) {
      availableReturns.returns_1y = parseFloat(returns_1y);
      totalAvailableWeight += this.baseWeights.returns_1y;
    }
    
    if (returns_3y !== null && returns_3y !== undefined && !isNaN(returns_3y)) {
      availableReturns.returns_3y = parseFloat(returns_3y);
      totalAvailableWeight += this.baseWeights.returns_3y;
    }
    
    if (returns_5y !== null && returns_5y !== undefined && !isNaN(returns_5y)) {
      availableReturns.returns_5y = parseFloat(returns_5y);
      totalAvailableWeight += this.baseWeights.returns_5y;
    }
    
    if (returns_1w !== null && returns_1w !== undefined && !isNaN(returns_1w)) {
      availableReturns.returns_1w = parseFloat(returns_1w);
      totalAvailableWeight += this.baseWeights.returns_1w;
    }
    
    // If no returns data available, return 0
    if (totalAvailableWeight === 0) {
      return 0;
    }
    
    // Calculate weighted score with normalized weights
    let totalScore = 0;
    Object.keys(availableReturns).forEach(key => {
      const adjustedWeight = this.baseWeights[key] / totalAvailableWeight;
      totalScore += availableReturns[key] * adjustedWeight;
    });
    
    return totalScore;
  }

  /**
   * Get detailed score components for transparency
   * @param {Object} fundData - Fund data object
   * @param {Object} categoryAverages - Category averages data
   * @returns {Object} - Score breakdown
   */
  getScoreComponents(fundData, categoryAverages = null) {
    const { returns_1y, returns_3y, returns_5y, returns_1w, fund_category, fund_type } = fundData;
    
    const components = {};
    let totalWeight = 0;
    
    // If no category averages, use absolute returns
    if (!categoryAverages) {
      return this.getAbsoluteReturnsComponents(fundData);
    }
    
    // Determine category name
    let categoryName;
    if (fund_type && fund_type.toLowerCase().includes('equity')) {
      categoryName = fund_category;
    } else {
      categoryName = fund_category;
    }
    
    const categoryAvg = categoryAverages[categoryName];
    if (!categoryAvg) {
      return this.getAbsoluteReturnsComponents(fundData);
    }
    
    // Calculate available weights for outperformance
    const returnPairs = [
      { fund: returns_1y, category: categoryAvg.returns_1y, key: 'returns_1y' },
      { fund: returns_3y, category: categoryAvg.returns_3y, key: 'returns_3y' },
      { fund: returns_5y, category: categoryAvg.returns_5y, key: 'returns_5y' },
      { fund: returns_1w, category: categoryAvg.returns_1w, key: 'returns_1w' }
    ];
    
    returnPairs.forEach(pair => {
      if (pair.fund !== null && pair.fund !== undefined && !isNaN(pair.fund) &&
          pair.category !== null && pair.category !== undefined && !isNaN(pair.category)) {
        totalWeight += this.baseWeights[pair.key];
      }
    });
    
    // Calculate component contributions based on outperformance
    returnPairs.forEach(pair => {
      if (pair.fund !== null && pair.fund !== undefined && !isNaN(pair.fund) &&
          pair.category !== null && pair.category !== undefined && !isNaN(pair.category)) {
        
        const fundReturn = parseFloat(pair.fund);
        const categoryReturn = parseFloat(pair.category);
        const outperformance = fundReturn - categoryReturn;
        
        components[pair.key] = {
          fund_value: fundReturn,
          category_value: categoryReturn,
          outperformance: outperformance,
          weight: this.baseWeights[pair.key] / totalWeight,
          contribution: outperformance * (this.baseWeights[pair.key] / totalWeight)
        };
      }
    });
    
    return components;
  }

  /**
   * Get absolute returns components (fallback)
   * @param {Object} fundData - Fund data object
   * @returns {Object} - Score breakdown
   */
  getAbsoluteReturnsComponents(fundData) {
    const { returns_1y, returns_3y, returns_5y, returns_1w } = fundData;
    
    const components = {};
    let totalWeight = 0;
    
    // Calculate available weights
    if (returns_1y !== null && returns_1y !== undefined && !isNaN(returns_1y)) {
      totalWeight += this.baseWeights.returns_1y;
    }
    if (returns_3y !== null && returns_3y !== undefined && !isNaN(returns_3y)) {
      totalWeight += this.baseWeights.returns_3y;
    }
    if (returns_5y !== null && returns_5y !== undefined && !isNaN(returns_5y)) {
      totalWeight += this.baseWeights.returns_5y;
    }
    if (returns_1w !== null && returns_1w !== undefined && !isNaN(returns_1w)) {
      totalWeight += this.baseWeights.returns_1w;
    }
    
    // Calculate component contributions
    if (returns_1y !== null && returns_1y !== undefined && !isNaN(returns_1y)) {
      components.returns_1y = {
        value: parseFloat(returns_1y),
        weight: this.baseWeights.returns_1y / totalWeight,
        contribution: parseFloat(returns_1y) * (this.baseWeights.returns_1y / totalWeight)
      };
    }
    
    if (returns_3y !== null && returns_3y !== undefined && !isNaN(returns_3y)) {
      components.returns_3y = {
        value: parseFloat(returns_3y),
        weight: this.baseWeights.returns_3y / totalWeight,
        contribution: parseFloat(returns_3y) * (this.baseWeights.returns_3y / totalWeight)
      };
    }
    
    if (returns_5y !== null && returns_5y !== undefined && !isNaN(returns_5y)) {
      components.returns_5y = {
        value: parseFloat(returns_5y),
        weight: this.baseWeights.returns_5y / totalWeight,
        contribution: parseFloat(returns_5y) * (this.baseWeights.returns_5y / totalWeight)
      };
    }
    
    if (returns_1w !== null && returns_1w !== undefined && !isNaN(returns_1w)) {
      components.returns_1w = {
        value: parseFloat(returns_1w),
        weight: this.baseWeights.returns_1w / totalWeight,
        contribution: parseFloat(returns_1w) * (this.baseWeights.returns_1w / totalWeight)
      };
    }
    
    return components;
  }

  /**
   * Normalize fund scores within categories to 50-100 range
   * @param {Array} fundsWithScores - Array of fund objects with raw scores
   * @returns {Array} - Funds with normalized scores
   */
  normalizeFundScores(fundsWithScores) {
    try {
      // Group funds by category
      const categories = {};
      
      fundsWithScores.forEach(fund => {
        let categoryKey;
        
        // For equity funds, group by fund_category
        if (fund.fund_type && fund.fund_type.toLowerCase().includes('equity')) {
          categoryKey = fund.fund_category || 'equity_other';
        } 
        // For other funds, group by fund_category
        else {
          categoryKey = fund.fund_category || 'unknown';
        }
        
        if (!categories[categoryKey]) {
          categories[categoryKey] = [];
        }
        categories[categoryKey].push(fund);
      });
      
      // Normalize scores within each category
      Object.keys(categories).forEach(categoryKey => {
        const categoryFunds = categories[categoryKey];
        
        // Find the highest and lowest scores in this category
        const maxScore = Math.max(...categoryFunds.map(fund => fund.total_score));
        const minScore = Math.min(...categoryFunds.map(fund => fund.total_score));
        
        // Edge Case 1: If maxScore is 0 or negative, set all scores to 50
        if (maxScore <= 0) {
          categoryFunds.forEach(fund => {
            fund.total_score = 50;
          });
          return;
        }
        
        // Edge Case 2: If all funds have the same score, give them all 100
        if (maxScore === minScore) {
          categoryFunds.forEach(fund => {
            fund.total_score = 100;
          });
          return;
        }
        
        // Standard Case: Normalize to 50-100 range
        categoryFunds.forEach(fund => {
          // Linear scaling: (score - min) / (max - min) * 50 + 50
          const normalizedScore = ((fund.total_score - minScore) / (maxScore - minScore)) * 50 + 50;
          fund.total_score = Math.round(normalizedScore * 100) / 100; // Round to 2 decimal places
        });
      });
      
      return fundsWithScores;
    } catch (error) {
      console.error('Error normalizing fund scores:', error);
      return fundsWithScores;
    }
  }

  /**
   * Calculate category-wise statistics
   * @param {Array} funds - Array of fund objects
   * @returns {Object} - Statistics by category
   */
  getCategoryStatistics(funds) {
    const stats = {};
    
    // Group funds by category
    funds.forEach(fund => {
      let categoryKey;
      
      if (fund.fund_type && fund.fund_type.toLowerCase().includes('equity')) {
        categoryKey = fund.fund_category || 'equity_other';
      } else {
        categoryKey = fund.fund_category || 'unknown';
      }
      
      if (!stats[categoryKey]) {
        stats[categoryKey] = {
          count: 0,
          scores: [],
          avgScore: 0,
          minScore: Infinity,
          maxScore: -Infinity
        };
      }
      
      stats[categoryKey].count++;
      stats[categoryKey].scores.push(fund.total_score);
      stats[categoryKey].minScore = Math.min(stats[categoryKey].minScore, fund.total_score);
      stats[categoryKey].maxScore = Math.max(stats[categoryKey].maxScore, fund.total_score);
    });
    
    // Calculate averages
    Object.keys(stats).forEach(category => {
      const categoryStats = stats[category];
      categoryStats.avgScore = categoryStats.scores.reduce((sum, score) => sum + score, 0) / categoryStats.count;
      categoryStats.avgScore = Math.round(categoryStats.avgScore * 100) / 100;
    });
    
    return stats;
  }

  /**
   * Validate fund data for scoring
   * @param {Object} fundData - Fund data object
   * @returns {Object} - Validation result
   */
  validateFundData(fundData) {
    const issues = [];
    
    // Check if at least one return period is available
    const hasAnyReturns = [
      fundData.returns_1y,
      fundData.returns_3y,
      fundData.returns_5y,
      fundData.returns_1w
    ].some(value => value !== null && value !== undefined && !isNaN(value));
    
    if (!hasAnyReturns) {
      issues.push('No valid return data available for scoring');
    }
    
    // Check for reasonable return values (basic sanity check)
    if (fundData.returns_1y !== null && fundData.returns_1y !== undefined) {
      const returns1y = parseFloat(fundData.returns_1y);
      if (returns1y < -100 || returns1y > 1000) {
        issues.push('1-year return value seems unreasonable');
      }
    }
    
    return {
      isValid: issues.length === 0,
      issues: issues
    };
  }

  /**
   * Get scoring methodology explanation
   * @returns {Object} - Methodology details
   */
  getScoringMethodology() {
    return {
      description: 'Weighted outperformance scoring based on category relative performance',
      weights: this.baseWeights,
      normalization: '50-100 range within fund categories',
      rationale: {
        'returns_1y': 'Most important - captures full market cycle outperformance',
        'returns_3y': 'Medium-term consistency over category average',
        'returns_5y': 'Long-term outperformance capability',
        'returns_1w': 'Recent momentum relative to category'
      },
      process: [
        '1. Calculate outperformance (fund_return - category_average) for each period',
        '2. Apply weighted scoring based on available outperformance data',
        '3. Group funds by category (equity by fund_category)',
        '4. Normalize scores within each category to 50-100 range',
        '5. Linear scaling: (score - min) / (max - min) * 50 + 50'
      ],
      category_matching: {
        'equity_funds': 'Match fund_category with category_averages.category_name',
        'fallback': 'Use absolute returns if no category averages available'
      }
    };
  }
}

module.exports = new ScoringUtils();