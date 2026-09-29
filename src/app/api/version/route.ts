export const dynamic = "force-dynamic";

/** The build id this server was built with; open tabs compare it against
 * the one baked into their own bundle (see useAutoUpdate). */
export function GET() {
  return Response.json(
    { buildId: process.env.NEXT_PUBLIC_BUILD_ID ?? null },
    { headers: { "Cache-Control": "no-store" } },
  );
}
