/**
 * A collection of statistical utility functions.
 */

/**
 * Calculates the arithmetic mean (average) of an array of numbers.
 * @param values - An array of numbers.
 * @returns The mean of the numbers.
 */
export function calculateMean(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, val) => sum + val, 0) / values.length;
}

/**
 * Calculates the variance of an array of numbers.
 * @param values - An array of numbers.
 * @returns The variance of the numbers.
 */
export function calculateVariance(values: number[]): number {
    if (values.length < 2) return 0;
    const mean = calculateMean(values);
    return values.reduce((sum, val) => sum + (val - mean) ** 2, 0) / values.length;
}

/**
 * Calculates the standard deviation of an array of numbers.
 * @param values - An array of numbers.
 * @returns The standard deviation of the numbers.
 */
export function calculateStdDev(values: number[]): number {
    return Math.sqrt(calculateVariance(values));
}

/**
 * Calculates the linear trend (slope) of a series of numbers.
 * Assumes the x-values are equidistant (0, 1, 2, ...).
 * @param values - An array of numbers representing the y-values.
 * @returns The slope of the linear regression line.
 */
export function calculateTrend(values: number[]): number {
    if (values.length < 2) return 0;
    
    const n = values.length;
    const x = Array.from({length: n}, (_, i) => i);
    const meanX = (n - 1) / 2;
    const meanY = calculateMean(values);

    const numerator = x.reduce((sum, xi, i) => sum + (xi - meanX) * (values[i] - meanY), 0);
    const denominator = x.reduce((sum, xi) => sum + (xi - meanX) ** 2, 0);

    return denominator === 0 ? 0 : numerator / denominator;
} 