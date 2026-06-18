import "server-only";

const requiredServerEnv = {
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
};

export function getServerEnv() {
  const missing = Object.entries(requiredServerEnv)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  return requiredServerEnv as {
    SUPABASE_URL: string;
    SUPABASE_SECRET_KEY: string;
  };
}
