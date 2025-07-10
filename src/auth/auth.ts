export interface AuthConfig {
  apiKey?: string;
  clientId?: string;
  clientSecret?: string;
}

export function getAuthConfig(): AuthConfig {
  return {
    apiKey: process.env.TRIBEUNAL_API_KEY,
    clientId: process.env.TRIBEUNAL_CLIENT_ID,
    clientSecret: process.env.TRIBEUNAL_CLIENT_SECRET,
  };
}

export function validateAuth(): void {
  const config = getAuthConfig();
  
  if (!config.apiKey && (!config.clientId || !config.clientSecret)) {
    throw new Error(
      'Authentication not configured. Please set either TRIBEUNAL_API_KEY or both TRIBEUNAL_CLIENT_ID and TRIBEUNAL_CLIENT_SECRET in your environment.'
    );
  }
}