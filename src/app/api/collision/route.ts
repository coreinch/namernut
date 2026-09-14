import { checkCollision } from "@/lib/collision";

export const dynamic = "force-dynamic";

/** Same sanitization as parseKeyword in lib/candidates.ts — plain lowercase
 * letters/digits only, so this can't be used to smuggle an arbitrary query
 * into Brave Search via the `name` param. */
function parseName(raw: string | null): string | null {
  if (!raw) return null;
  const cleaned = raw.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 30);
  return cleaned.length > 0 ? cleaned : null;
}

/** The two literal strings the candidate was concatenated from — see
 * Candidate.parts in lib/candidates.ts — passed straight through from
 * FoundEntry rather than re-derived here. checkCollision/validateParts
 * re-checks that they actually concatenate to `name` before using them for
 * anything, so no further sanitization is needed beyond a sane length cap. */
function parseParts(word1: string | null, word2: string | null): [string, string] | undefined {
  if (!word1 || !word2) return undefined;
  return [word1.slice(0, 30), word2.slice(0, 30)];
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const name = parseName(searchParams.get("name"));
  const parts = parseParts(searchParams.get("word1"), searchParams.get("word2"));
  if (!name) {
    return Response.json({ error: "Missing or invalid 'name' query param" }, { status: 400 });
  }

  try {
    const result = await checkCollision(name, parts, request.signal);
    return Response.json(result);
  } catch (err) {
    if (err instanceof Error && err.name === "BraveApiKeyMissingError") {
      return Response.json(
        { error: "BRAVE_API_KEY is not configured on the server (see .env.local)" },
        { status: 503 }
      );
    }
    if (err instanceof Error && err.name === "RateLimitError") {
      return Response.json({ error: "Brave Search rate limit hit — try again shortly." }, { status: 429 });
    }
    return Response.json(
      { error: err instanceof Error ? err.message : "Collision check failed" },
      { status: 500 }
    );
  }
}
