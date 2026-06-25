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
  const expectedTokens = [
    process.env.INTERNAL_API_TOKEN,
    process.env.CRON_SECRET,
  ].filter(Boolean);

  if (expectedTokens.length === 0) {
    return false;
  }

  const headerToken = request.headers.get("x-internal-token");
  const bearerToken = request.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "");

  return expectedTokens.some(
    (expected) => headerToken === expected || bearerToken === expected,
  );
}
