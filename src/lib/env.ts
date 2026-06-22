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

export function requireInternalToken(request: Request) {
  const expected = process.env.INTERNAL_API_TOKEN;
  if (!expected) {
    return false;
  }

  const actual = request.headers.get("x-internal-token");
  return actual === expected;
}
