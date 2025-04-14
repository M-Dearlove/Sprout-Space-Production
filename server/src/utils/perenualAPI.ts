import axios from 'axios';

// Define interfaces based on Perenual API response
interface PerenualPlantData {
  id: number;
  common_name: string;
  scientific_name: string[];
  other_name: string[];
  cycle: string;
  watering: string;
  sunlight: string[];
  default_image: {
    thumbnail: string;
  };
  type?: string;
  dimensions?: {
    min_height?: number;
    max_height?: number;
  }
}

interface PerenualApiResponse {
  data: PerenualPlantData[];
  total: number;
  current_page: number;
  last_page: number;
}

// Convert Perenual data to match our Plant database schema
export const convertPerenualToAppPlant = (plant: PerenualPlantData) => {
  // Generate a color based on plant id
  const colors = ['#ff6b6b', '#ff9f43', '#1dd1a1', '#10ac84', '#2e86de', '#f9ca24', '#6ab04c', '#eb4d4b'];
  const color = colors[plant.id % colors.length];
  
  // Default spacing based on plant height if available
  let spacing = 12; // default spacing in inches
  if (plant.dimensions?.max_height) {
    // Simple logic to estimate spacing based on height
    if (plant.dimensions.max_height > 200) spacing = 24;
    else if (plant.dimensions.max_height > 100) spacing = 18;
    else if (plant.dimensions.max_height > 50) spacing = 12;
    else spacing = 6;
  }
  
  // Calculate plants per square foot based on spacing
  const calculatePlantsPerSquareFoot = (spacing: number): number => {
    if (spacing >= 18) return 0.25; // 1 plant per 4 squares
    if (spacing >= 12) return 1;
    if (spacing >= 6) return 4;
    if (spacing >= 4) return 9;
    return 16; // 3 inches or less spacing
  };

  return {
    _id: `perenual-${plant.id}`,
    id: `perenual-${plant.id}`,
    plantName: plant.common_name,
    plantType: plant.type || "Unknown",
    plantDescription: "Description from Perenual API", // Add required fields
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

// Fetch plants from Perenual API
// Replace the current API key check with this more robust implementation
export const searchPerenualPlants = async (searchTerm: string, limit: number = 8) => {
    try {
      // You would store your API key in an environment variable
      const API_KEY = process.env.REACT_APP_PERENUAL_API_KEY;
      
      if (!API_KEY) {
        console.error('Perenual API key is missing!');
        // Return a structured error that can be handled by the resolver
        return { error: "API_KEY_MISSING" };
      }
      
      const response = await axios.get<PerenualApiResponse>(`https://perenual.com/api/species-list`, {
        params: {
          key: API_KEY,
          q: searchTerm,
          page: 1,
          limit
        }
      });
      
      // Log the response for debugging
      console.log('Perenual API raw response:', response.data);
      
      if (response.data && response.data.data) {
        return response.data.data.map(convertPerenualToAppPlant);
      }
      
      // Return empty array with a more descriptive log
      console.log('No plants found in Perenual API response');
      return [];
    } catch (error) {
      // Log the full error for debugging
      console.error('Error fetching plants from Perenual API:', error);
      if (axios.isAxiosError(error)) {
        console.error('API response:', error.response?.data);
      }
      // Return the error instead of throwing it to allow better handling
      return { error: (error instanceof Error ? error.message : "Unknown API error") };
    }
  };