import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    message: "hello from quorum-for-apps",
    shipped_at: new Date().toISOString(),
  });
}
