import axios from 'axios';

// Define interfaces based on Perenual API response
interface PerenualPlantData {
  id: number;
  common_name: string;
  scientific_name?: string[];
  other_name?: string[];
  family?: string;
  origin?: string[];
  type?: string;
  dimensions?: {
    min_value?: number;
    max_value?: number;
    unit?: string;
  };
  cycle?: string;
  watering?: string;
  sunlight?: string[];
  default_image?: {
    license?: number;
    license_name?: string;
    license_url?: string;
    original_url?: string;
    regular_url?: string;
    medium_url?: string;
    small_url?: string;
    thumbnail?: string;
  };
}

interface PerenualApiResponse {
  data: PerenualPlantData[];
  total: number;
  current_page: number;
  last_page: number;
}

// Rate limiting configuration
interface RateLimitConfig {
  maxRequestsPerMinute: number;
  maxConcurrentRequests: number;
}

// Rate limiter class to manage API requests
class RateLimiter {
  private requestTimestamps: number[] = [];
  private pendingRequests: Array<{ resolve: Function; reject: Function; execute: Function }> = [];
  private activeRequests = 0;
  private config: RateLimitConfig;

  constructor(config: RateLimitConfig) {
    this.config = config;
  }

  // Check if we can make a request now
  private canMakeRequest(): boolean {
    const now = Date.now();
    // Remove timestamps older than 1 minute
    this.requestTimestamps = this.requestTimestamps.filter(
      timestamp => now - timestamp < 60000
    );

    return (
      this.requestTimestamps.length < this.config.maxRequestsPerMinute &&
      this.activeRequests < this.config.maxConcurrentRequests
    );
  }

  // Add a request to the queue
  private addToQueue(execute: Function): Promise<any> {
    return new Promise((resolve, reject) => {
      this.pendingRequests.push({ resolve, reject, execute });
      this.processQueue();
    });
  }

  // Process the queue of pending requests
  private processQueue(): void {
    if (this.pendingRequests.length === 0) return;

    if (this.canMakeRequest()) {
      const { resolve, reject, execute } = this.pendingRequests.shift()!;

      this.activeRequests++;
      this.requestTimestamps.push(Date.now());

      execute()
        .then(resolve)
        .catch(reject)
        .finally(() => {
          this.activeRequests--;
          setTimeout(() => this.processQueue(), 100); // Small delay before processing next request
        });
    } else {
      // Schedule next check
      setTimeout(() => this.processQueue(), 1000);
    }
  }

  // Execute a request through the rate limiter
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.canMakeRequest()) {
      this.activeRequests++;
      this.requestTimestamps.push(Date.now());

      try {
        return await fn();
      } finally {
        this.activeRequests--;
      }
    }

    return this.addToQueue(fn);
  }
}

// Create a rate limiter instance (adjust values based on API documentation or experimentation)
const rateLimiter = new RateLimiter({
  maxRequestsPerMinute: 30, // Adjust based on your API tier
  maxConcurrentRequests: 3
});

// Retry logic with exponential backoff
// Retry logic with exponential backoff
async function retryRequest<T>(fn: () => Promise<T>, maxRetries = 3, maxRetryDelay = 5000): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;

      // If it's not a rate limit error, or we've used all retries, throw the error
      if (
        !axios.isAxiosError(error) ||
        error.response?.status !== 429 ||
        attempt === maxRetries
      ) {
        throw error;
      }

      // Calculate backoff time - exponential backoff with jitter
      const backoffMs = Math.min(1000 * Math.pow(2, attempt), 30000) + Math.random() * maxRetryDelay;
      console.log(`Rate limit hit. Retrying in ${backoffMs}ms (attempt ${attempt + 1}/${maxRetries})`);

      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, backoffMs));
    }
  }

  throw lastError || new Error("Request failed after retries");
}

// Convert Perenual data to match our Plant database schema
export const convertPerenualToAppPlant = (plant: PerenualPlantData) => {
  // Generate a color based on plant id
  const colors = ['#ff6b6b', '#ff9f43', '#1dd1a1', '#10ac84', '#2e86de', '#f9ca24', '#6ab04c', '#eb4d4b'];
  const color = colors[plant.id % colors.length];

  // Default spacing based on plant height if available
  let spacing = 12; // default spacing in inches

  if (plant.dimensions) {
    console.log(`Dimensions for ${plant.common_name}:`, JSON.stringify(plant.dimensions));

    // Extract the max value and unit if available
    const maxValue = plant.dimensions.max_value;
    const unit = plant.dimensions.unit?.toLowerCase() || 'unknown';

    if (maxValue) {
      // Convert to inches based on the unit
      let maxValueInches: number;

      if (unit.includes('cm') || unit === 'centimeter' || unit === 'centimeters') {
        // Convert from centimeters to inches
        maxValueInches = maxValue / 2.54;
        console.log(`Converting ${maxValue} cm to ${maxValueInches.toFixed(1)} inches`);
      }
      else if (unit.includes('ft') || unit === 'foot' || unit === 'feet') {
        // Convert from feet to inches
        maxValueInches = maxValue * 12;
        console.log(`Converting ${maxValue} ft to ${maxValueInches.toFixed(1)} inches`);
      }
      else if (unit.includes('m') || unit === 'meter' || unit === 'meters') {
        // Convert from meters to inches
        maxValueInches = maxValue * 39.37;
        console.log(`Converting ${maxValue} m to ${maxValueInches.toFixed(1)} inches`);
      }
      else {
        // Assume inches or unknown unit
        maxValueInches = maxValue;
        console.log(`Using ${maxValue} as inches (unit: ${unit})`);
      }

      // Determine spacing based on height in inches
      if (maxValueInches > 78) { // ~6.5 feet or 200 cm
        spacing = 24; // 2 feet spacing
      }
      else if (maxValueInches > 39) { // ~3.3 feet or 100 cm
        spacing = 18; // 1.5 feet spacing
      }
      else if (maxValueInches > 20) { // ~1.7 feet or 50 cm
        spacing = 12; // 1 foot spacing
      }
      else {
        spacing = 6; // 6 inches spacing for small plants
      }

      console.log(`Calculated spacing for ${plant.common_name}: ${spacing} inches`);
    } else {
      console.log(`No max_value found for ${plant.common_name}, using default spacing`);
    }
  } else {
    console.log(`No dimensions data for ${plant.common_name}, using default spacing`);
  }

  // Calculate plants per square foot based on spacing
  const calculatePlantsPerSquareFoot = (spacing: number): number => {
    if (spacing >= 18) return 0.25; // 1 plant per 4 squares
    if (spacing >= 12) return 1;
    if (spacing >= 6) return 4;
    if (spacing >= 4) return 9;
    return 16; // 3 inches or less spacing
  };

  // Get a meaningful description if available
  const description = plant.scientific_name ?
    `${plant.common_name} (${plant.scientific_name.join(', ')})` :
    `${plant.common_name} - Cycle: ${plant.cycle || 'Unknown'}`;

  return {
    perenualId: `perenual-${plant.id}`,
    id: `perenual-${plant.id}`,
    plantName: plant.common_name,
    plantType: plant.type || "Unknown",
    plantDescription: description,
    plantImage: plant.default_image?.thumbnail || 'https://cdn-icons-png.flaticon.com/128/628/628324.png',
    plantWatering: plant.watering || 'Unknown',
    plantLight: Array.isArray(plant.sunlight) && plant.sunlight.length > 0
      ? plant.sunlight.join(', ')
      : 'Unknown',
    plantSoil: "Generic soil requirements",
    plantFertilizer: "Generic fertilizer information",
    plantHumidity: "Generic humidity information",
    plantTemperature: "Generic temperature range",
    plantToxicity: "Unknown",
    plantPests: "Common pests information",
    plantDiseases: "Common diseases information",
    spacing: spacing,
    plantsPerSquareFoot: calculatePlantsPerSquareFoot(spacing),
    color: color
  };
};

// Cache for API responses
const apiCache: Map<string, { data: any; timestamp: number }> = new Map();
const CACHE_TTL = 1000 * 60 * 60; // 1 hour

export const getPlantDetails = async (plantId: number, apiKey: string) => {
  const cacheKey = `plant-details-${plantId}`;
  const cachedData = apiCache.get(cacheKey);

  // Return cached data if available and fresh
  if (cachedData && Date.now() - cachedData.timestamp < CACHE_TTL) {
    console.log(`Using cached data for plant ID ${plantId}`);
    return cachedData.data;
  }

  try {
    // Execute the request through our rate limiter with retry logic
    // Execute the request through our rate limiter with retry logic
    const data = await rateLimiter.execute(async () => {
      return retryRequest(async () => {
        const response = await axios.get(
          `https://perenual.com/api/v2/species/details/${plantId}`,
          { params: { key: apiKey } }
        );
        return response.data;
      }, 3, 5000); // Pass maxRetries and maxRetryDelay as parameters
    });

    // Cache the result
    apiCache.set(cacheKey, { data, timestamp: Date.now() });

    console.log(`Retrieved detailed data for plant ID ${plantId}`);
    return data;
  } catch (error) {
    console.error(`Error fetching details for plant ID ${plantId}:`, error);
    return null;
  }
};

// Fetch plants from Perenual API with rate limiting
export const searchPerenualPlants = async (searchTerm: string, limit: number = 8) => {
  try {
    const API_KEY = process.env.REACT_APP_PERENUAL_API_KEY;

    if (!API_KEY) {
      console.error('Perenual API key is missing!');
      return { error: "API_KEY_MISSING" };
    }

    // Check cache first
    const cacheKey = `search-${searchTerm}-${limit}`;
    const cachedData = apiCache.get(cacheKey);

    if (cachedData && Date.now() - cachedData.timestamp < CACHE_TTL) {
      console.log(`Using cached data for search: ${searchTerm}`);
      return cachedData.data;
    }

    // Execute the request through our rate limiter with retry logic
    const response = await rateLimiter.execute(async () => {
      return retryRequest(async () => {
        return await axios.get<PerenualApiResponse>(`https://perenual.com/api/species-list`, {
          params: {
            key: API_KEY,
            q: searchTerm,
            page: 1,
            limit
          }
        });
      }, 3, 5000); // Pass maxRetries and maxRetryDelay as parameters
    });

    console.log('Perenual API raw response:', response.data);

    if (response.data && response.data.data) {
      // Fetch details in batches to reduce concurrent API calls
      const plants = response.data.data;
      const detailedPlants = [];
      const batchSize = 3; // Process 3 plants at a time

      for (let i = 0; i < plants.length; i += batchSize) {
        const batch = plants.slice(i, i + batchSize);
        const batchResults = await Promise.all(
          batch.map(async (basicPlant) => {
            const details = await getPlantDetails(basicPlant.id, API_KEY);

            // Merge the basic plant data with the detailed data
            return {
              ...basicPlant,
              dimensions: details?.dimensions || undefined,
              // Add other detailed fields you need
            };
          })
        );

        detailedPlants.push(...batchResults);
      }

      const result = detailedPlants.map(convertPerenualToAppPlant);

      // Cache the result
      apiCache.set(cacheKey, { data: result, timestamp: Date.now() });

      return result;
    }

    console.log('No plants found in Perenual API response');
    return [];
  } catch (error) {
    console.error('Error fetching plants from Perenual API:', error);
    if (axios.isAxiosError(error)) {
      console.error('API response:', error.response?.data);
    }
    return { error: (error instanceof Error ? error.message : "Unknown API error") };
  }
};