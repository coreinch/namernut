import { parseKeyword } from "@/lib/candidates";
import { getDictionaryStats, parseLangs, parseMaxLength } from "@/lib/dictionary";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const langs = parseLangs(searchParams.get("langs"));
  const maxLength = parseMaxLength(searchParams.get("maxLength"));
  const keyword = parseKeyword(searchParams.get("keyword"));
  try {
    return Response.json(getDictionaryStats(langs, maxLength, keyword));
  } catch (err) {
    // Matches the {error: "..."} JSON contract every other route returns —
    // without this, an unexpected throw here falls through to Next's raw
    // HTML error page, which the frontend isn't prepared to parse.
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to compute dictionary stats" },
      { status: 500 }
    );
  }
}
