import type { CO2TrainingData, ModelMetrics } from '../types';

export interface TrainTestSplit {
  trainData: CO2TrainingData[];
  testData: CO2TrainingData[];
  trainRatio: number;
  realCO2InTrain: number;
  realCO2InTest: number;
}

export interface ValidationResult {
  predictions: Array<{
    timestamp: number;
    actual: number;
    predicted: number;
    confidence: number;
    hasRealTarget: boolean;
  }>;
  metrics: ModelMetrics;
  split: TrainTestSplit;
}

/**
 * Split training data into train/test sets using temporal split
 * (earlier data for training, later data for testing)
 */
export function splitTrainingData(
  data: CO2TrainingData[], 
  trainRatio: number = 0.7
): TrainTestSplit {
  if (data.length === 0) {
    return {
      trainData: [],
      testData: [],
      trainRatio,
      realCO2InTrain: 0,
      realCO2InTest: 0
    };
  }

  // Sort by timestamp to ensure temporal order
  const sortedData = [...data].sort((a, b) => a.timestamp - b.timestamp);
  
  // Split point
  const splitIndex = Math.floor(sortedData.length * trainRatio);
  
  const trainData = sortedData.slice(0, splitIndex);
  const testData = sortedData.slice(splitIndex);
  
  const realCO2InTrain = trainData.filter(item => item.hasRealTarget).length;
  const realCO2InTest = testData.filter(item => item.hasRealTarget).length;
  
  console.log(`[Validation] Split ${data.length} samples: ${trainData.length} train, ${testData.length} test`);
  console.log(`[Validation] Real CO₂ targets: ${realCO2InTrain} train, ${realCO2InTest} test`);
  
  return {
    trainData,
    testData,
    trainRatio,
    realCO2InTrain,
    realCO2InTest
  };
}

/**
 * Validate model performance on test set
 */
export function validateModel(
  model: any,
  testData: CO2TrainingData[]
): ModelMetrics {
  if (testData.length === 0) {
    return {
      mae: 0,
      mse: 0,
      rmse: 0,
      mape: 0,
      r2: 0,
      trainingSamples: 0,
      lastTrainingTime: Date.now()
    };
  }

  const predictions: number[] = [];
  const actuals: number[] = [];
  
  let validPredictions = 0;
  let totalError = 0;
  let totalSquaredError = 0;
  let totalPercentError = 0;

  // Make predictions for each test point
  testData.forEach(testPoint => {
    try {
      if (!testPoint.hasRealTarget) return; // Skip synthetic data points
      
      const prediction = model.predict(testPoint.features);
      const actual = testPoint.target;
      
      predictions.push(prediction.predictedCO2);
      actuals.push(actual);
      
      const error = Math.abs(prediction.predictedCO2 - actual);
      const squaredError = Math.pow(prediction.predictedCO2 - actual, 2);
      const percentError = actual !== 0 ? error / Math.abs(actual) : 0;
      
      totalError += error;
      totalSquaredError += squaredError;
      totalPercentError += percentError;
      validPredictions++;
      
    } catch (error) {
      console.warn('[Validation] Prediction failed for test point:', error);
    }
  });

  if (validPredictions === 0) {
    console.warn('[Validation] No valid predictions made on test set');
    return {
      mae: 0,
      mse: 0,
      rmse: 0,
      mape: 0,
      r2: 0,
      trainingSamples: testData.length,
      lastTrainingTime: Date.now()
    };
  }

  // Calculate metrics
  const mae = totalError / validPredictions;
  const mse = totalSquaredError / validPredictions;
  const rmse = Math.sqrt(mse);
  const mape = totalPercentError / validPredictions;

  // R-squared calculation
  const actualMean = actuals.reduce((a, b) => a + b, 0) / actuals.length;
  const totalSumSquares = actuals.reduce((sum, val) => sum + Math.pow(val - actualMean, 2), 0);
  const residualSumSquares = actuals.reduce((sum, val, i) => 
    sum + Math.pow(val - predictions[i], 2), 0);
  const r2 = totalSumSquares === 0 ? 0 : Math.max(0, 1 - (residualSumSquares / totalSumSquares));

  console.log(`[Validation] Test metrics: MAE=${mae.toFixed(3)}, RMSE=${rmse.toFixed(3)}, R²=${r2.toFixed(3)}`);

  return {
    mae,
    mse,
    rmse,
    mape,
    r2,
    trainingSamples: validPredictions,
    lastTrainingTime: Date.now()
  };
}

/**
 * Perform full validation: split data, train, test, and return results
 */
export function performFullValidation(
  model: any,
  allData: CO2TrainingData[],
  trainRatio: number = 0.7
): ValidationResult {
  console.log(`[Validation] Starting full validation on ${allData.length} samples`);
  
  // Split data
  const split = splitTrainingData(allData, trainRatio);
  
  if (split.trainData.length === 0) {
    throw new Error('No training data available after split');
  }
  
  if (split.testData.length === 0) {
    throw new Error('No test data available after split');
  }

  // Train model on training set only
  console.log(`[Validation] Training model on ${split.trainData.length} samples`);
  model.train(split.trainData);
  
  // Test on test set
  console.log(`[Validation] Testing model on ${split.testData.length} samples`);
  const metrics = validateModel(model, split.testData);
  
  // Generate prediction vs actual data for visualization
  const predictions = split.testData
    .filter(testPoint => testPoint.hasRealTarget)
    .map(testPoint => {
      try {
        const prediction = model.predict(testPoint.features);
        return {
          timestamp: testPoint.timestamp,
          actual: testPoint.target,
          predicted: prediction.predictedCO2,
          confidence: prediction.confidence,
          hasRealTarget: testPoint.hasRealTarget || false
        };
      } catch (error) {
        console.warn('[Validation] Failed to predict for visualization:', error);
        return null;
      }
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  console.log(`[Validation] Generated ${predictions.length} prediction comparisons`);

  return {
    predictions,
    metrics,
    split
  };
}

/**
 * Calculate baseline metrics (naive predictor using moving average)
 */
export function calculateBaselineMetrics(testData: CO2TrainingData[], windowSize: number = 5): ModelMetrics {
  const realTargets = testData.filter(item => item.hasRealTarget);
  
  if (realTargets.length < windowSize + 1) {
    return {
      mae: 0, mse: 0, rmse: 0, mape: 0, r2: 0,
      trainingSamples: realTargets.length,
      lastTrainingTime: Date.now()
    };
  }

  let totalError = 0;
  let totalSquaredError = 0;
  let totalPercentError = 0;
  let validPredictions = 0;
  
  const actuals: number[] = [];
  const predictions: number[] = [];

  // Use moving average as naive predictor
  for (let i = windowSize; i < realTargets.length; i++) {
    const actual = realTargets[i].target;
    const previousValues = realTargets.slice(i - windowSize, i).map(item => item.target);
    const predicted = previousValues.reduce((a, b) => a + b, 0) / previousValues.length;
    
    actuals.push(actual);
    predictions.push(predicted);
    
    const error = Math.abs(predicted - actual);
    const squaredError = Math.pow(predicted - actual, 2);
    const percentError = actual !== 0 ? error / Math.abs(actual) : 0;
    
    totalError += error;
    totalSquaredError += squaredError;
    totalPercentError += percentError;
    validPredictions++;
  }

  const mae = totalError / validPredictions;
  const mse = totalSquaredError / validPredictions;
  const rmse = Math.sqrt(mse);
  const mape = totalPercentError / validPredictions;

  // R-squared for baseline
  const actualMean = actuals.reduce((a, b) => a + b, 0) / actuals.length;
  const totalSumSquares = actuals.reduce((sum, val) => sum + Math.pow(val - actualMean, 2), 0);
  const residualSumSquares = actuals.reduce((sum, val, i) => 
    sum + Math.pow(val - predictions[i], 2), 0);
  const r2 = totalSumSquares === 0 ? 0 : 1 - (residualSumSquares / totalSumSquares);

  return { mae, mse, rmse, mape, r2, trainingSamples: validPredictions, lastTrainingTime: Date.now() };
} 