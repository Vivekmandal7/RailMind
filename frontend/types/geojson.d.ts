declare module "*.geojson" {
  const value: {
    type: string;
    name?: string;
    source?: string;
    features: Array<{
      type: string;
      properties: Record<string, any>;
      geometry: { type: string; coordinates: any };
    }>;
  };
  export default value;
}
