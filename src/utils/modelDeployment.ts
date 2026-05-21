import type { CO2TrainingData, ModelMetrics } from '../types';

export interface SerializedModel {
  version: string;
  modelType: 'ImprovedKMeans';
  createdAt: number;
  trainedOn: number; // Number of samples
  realCO2Samples: number;
  clusterCenters: Array<{
    features: CO2TrainingData['features'];
    CO2: number;
    count: number;
  }>;
  featureWeights: Record<string, number>;
  featureStats: {
    means: Record<string, number>;
    stds: Record<string, number>;
    mins: Record<string, number>;
    maxs: Record<string, number>;
  };
  validationMetrics?: ModelMetrics;
  config: {
    windowSize: number;
    maxClusters: number;
    minDistance: number;
  };
}

export interface ClientPredictionFeatures {
  temperature: number;
  temperatureAvg: number;
  temperatureGradient: number;
  primaryAirPosition: number;
  secondaryAirPosition: number;
  cycleTime: number;
  performance: number;
  // Note: currentCO and currentCO2 are excluded for client prediction
}

/**
 * Export trained model to serializable format for client deployment
 */
export function exportModelForDeployment(
  model: any,
  trainingData: CO2TrainingData[],
  validationMetrics?: ModelMetrics
): SerializedModel {
  console.log('[ModelDeployment] Exporting model for client deployment...');

  if (!model || !('getClusterCenters' in model)) {
    throw new Error('Invalid model: cannot access cluster centers');
  }

  const clusterCenters = model.getClusterCenters();
  if (!clusterCenters || clusterCenters.length === 0) {
    throw new Error('Model has no cluster centers - not trained properly');
  }

  // Calculate feature statistics for normalization on client side
  const realTrainingData = trainingData.filter(item => item.hasRealTarget);
  if (realTrainingData.length === 0) {
    throw new Error('No real training data found - cannot export model');
  }

  const featureKeys = Object.keys(realTrainingData[0].features);
  const featureStats = {
    means: {} as Record<string, number>,
    stds: {} as Record<string, number>,
    mins: {} as Record<string, number>,
    maxs: {} as Record<string, number>
  };

  featureKeys.forEach(key => {
    const values = realTrainingData.map(item => item.features[key as keyof typeof item.features]);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    const std = Math.sqrt(variance);

    featureStats.means[key] = mean;
    featureStats.stds[key] = std;
    featureStats.mins[key] = Math.min(...values);
    featureStats.maxs[key] = Math.max(...values);
  });

  // Serialize cluster centers
  const serializedCenters = clusterCenters.map((center: any) => ({
    features: center.features,
    CO2: center.target,
    count: center.n || 1
  }));

  // Get feature weights if available
  const featureWeights = model.featureWeights || {};

  const serializedModel: SerializedModel = {
    version: '1.0.0',
    modelType: 'ImprovedKMeans',
    createdAt: Date.now(),
    trainedOn: trainingData.length,
    realCO2Samples: realTrainingData.length,
    clusterCenters: serializedCenters,
    featureWeights,
    featureStats,
    validationMetrics,
    config: {
      windowSize: 10, // Default from ML config
      maxClusters: clusterCenters.length,
      minDistance: 0.1
    }
  };

  console.log(`[ModelDeployment] Exported model with ${serializedCenters.length} clusters, trained on ${realTrainingData.length} real samples`);
  return serializedModel;
}

/**
 * Client-side model for making predictions without CO2 sensors
 */
export class ClientSideModel {
  private serializedModel: SerializedModel;

  constructor(serializedModel: SerializedModel) {
    this.serializedModel = serializedModel;
    console.log(`[ClientModel] Loaded model v${serializedModel.version} with ${serializedModel.clusterCenters.length} clusters`);
  }

  /**
   * Make CO2 prediction using client-side features (no CO2 sensor required)
   */
  predict(features: ClientPredictionFeatures): {
    predictedCO2: number;
    confidence: number;
    nearestClusters: number;
    modelVersion: string;
  } {
    // Normalize features using training statistics
    const normalizedFeatures = this.normalizeFeatures(features);

    // Find k nearest cluster centers
    const k = Math.min(10, this.serializedModel.clusterCenters.length);
    const distances = this.serializedModel.clusterCenters.map((center, index) => ({
      distance: this.calculateWeightedDistance(normalizedFeatures, center.features),
      co2: center.CO2,
      count: center.count,
      index
    }));

    // Sort by distance and take k nearest
    distances.sort((a, b) => a.distance - b.distance);
    const kNearest = distances.slice(0, k);

    // Weighted prediction (closer centers have higher weight)
    let weightedSum = 0;
    let totalWeight = 0;

    kNearest.forEach((neighbor, idx) => {
      // Weight inversely proportional to distance + position penalty
      const weight = (1 / (neighbor.distance + 0.001)) * (k - idx) / k * Math.sqrt(neighbor.count);
      weightedSum += neighbor.co2 * weight;
      totalWeight += weight;
    });

    const predictedCO2 = totalWeight > 0 ? weightedSum / totalWeight : 0;

    // Calculate confidence based on variance of nearest clusters' predictions
    const nearestCO2Values = kNearest.map(n => n.co2);
    const mean = nearestCO2Values.reduce((a, b) => a + b, 0) / nearestCO2Values.length;
    const variance = nearestCO2Values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / nearestCO2Values.length;
    const confidence = Math.max(0, Math.min(1, 1 - Math.sqrt(variance) / (mean || 1)));

    return {
      predictedCO2: Math.max(0, Math.min(21, predictedCO2)), // Clamp to valid CO2 range
      confidence,
      nearestClusters: kNearest.length,
      modelVersion: this.serializedModel.version
    };
  }

  /**
   * Normalize features using training statistics
   */
  private normalizeFeatures(features: ClientPredictionFeatures): Record<string, number> {
    const normalized: Record<string, number> = {};

    Object.entries(features).forEach(([key, value]) => {
      const stats = this.serializedModel.featureStats;
      if (stats.stds[key] && stats.stds[key] > 0) {
        // Z-score normalization
        normalized[key] = (value - stats.means[key]) / stats.stds[key];
      } else {
        // Fallback to min-max if std is 0
        const range = stats.maxs[key] - stats.mins[key];
        normalized[key] = range > 0 ? (value - stats.mins[key]) / range : 0;
      }
    });

    return normalized;
  }

  /**
   * Calculate weighted distance between normalized features and cluster center
   */
  private calculateWeightedDistance(
    features1: Record<string, number>,
    features2: Record<string, number>
  ): number {
    let distance = 0;

    Object.keys(features1).forEach(key => {
      if (key === 'currentCO' || key === 'currentCO2') return; // Skip CO-related features for client prediction
      
      const weight = this.serializedModel.featureWeights[key] || 1.0;
      const diff = (features1[key] || 0) - (features2[key] || 0);
      distance += weight * diff * diff;
    });

    return Math.sqrt(distance);
  }

  /**
   * Get model metadata
   */
  getModelInfo() {
    return {
      version: this.serializedModel.version,
      trainedOn: this.serializedModel.trainedOn,
      realCO2Samples: this.serializedModel.realCO2Samples,
      clusterCount: this.serializedModel.clusterCenters.length,
      createdAt: new Date(this.serializedModel.createdAt).toLocaleString(),
      validationMetrics: this.serializedModel.validationMetrics
    };
  }
}

/**
 * Import serialized model for client-side usage
 */
export function importClientModel(serializedData: string | SerializedModel): ClientSideModel {
  try {
    const modelData = typeof serializedData === 'string' 
      ? JSON.parse(serializedData) as SerializedModel 
      : serializedData;

    if (!modelData.version || !modelData.clusterCenters) {
      throw new Error('Invalid model format');
    }

    if (modelData.clusterCenters.length === 0) {
      throw new Error('Model has no cluster centers');
    }

    console.log(`[ModelDeployment] Importing client model v${modelData.version}`);
    return new ClientSideModel(modelData);

  } catch (error) {
    console.error('[ModelDeployment] Failed to import model:', error);
    throw new Error(`Model import failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Validate model before deployment
 */
export function validateModelForDeployment(model: any, trainingData: CO2TrainingData[]): {
  isValid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check model structure
  if (!model) {
    errors.push('Model is null or undefined');
    return { isValid: false, errors, warnings };
  }

  if (!('getClusterCenters' in model)) {
    errors.push('Model does not have getClusterCenters method');
  }

  if (!('predict' in model)) {
    errors.push('Model does not have predict method');
  }

  // Check training data
  const realData = trainingData.filter(item => item.hasRealTarget);
  if (realData.length < 10) {
    errors.push(`Insufficient real training data: ${realData.length} samples (need 10+)`);
  } else if (realData.length < 50) {
    warnings.push(`Limited training data: ${realData.length} samples (recommended 50+)`);
  }

  // Check cluster centers
  try {
    const centers = model.getClusterCenters();
    if (!centers || centers.length === 0) {
      errors.push('Model has no cluster centers');
    } else if (centers.length < 5) {
      warnings.push(`Few cluster centers: ${centers.length} (may limit prediction quality)`);
    }
  } catch (error) {
    errors.push('Cannot access model cluster centers');
  }

  // Check feature coverage
  if (realData.length > 0) {
    const featureKeys = Object.keys(realData[0].features);
    const requiredFeatures = ['temperature', 'primaryAirPosition', 'secondaryAirPosition'];
    const missingFeatures = requiredFeatures.filter(key => !featureKeys.includes(key));
    if (missingFeatures.length > 0) {
      warnings.push(`Missing recommended features: ${missingFeatures.join(', ')}`);
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  };
} 