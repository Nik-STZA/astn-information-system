/**
 * API route to proxy client management data fetches to Cloud Run.
 * Used by ClientManagementClient.tsx for client-side detail loading.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  fetchEngagements,
  fetchRegistrations,
  fetchBreaches,
  fetchClientTasks,
  fetchClientCorrespondence,
} from "@/lib/data/client-management";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type");
  const clientId = searchParams.get("clientId");

  if (!clientId || !type) {
    return NextResponse.json({ error: "Missing type or clientId" }, { status: 400 });
  }

  let result;
  switch (type) {
    case "engagements":
      result = await fetchEngagements(clientId);
      break;
    case "registrations":
      result = await fetchRegistrations(clientId);
      break;
    case "breaches":
      result = await fetchBreaches(clientId);
      break;
    case "tasks":
      result = await fetchClientTasks(clientId);
      break;
    case "correspondence":
      result = await fetchClientCorrespondence(clientId);
      break;
    default:
      return NextResponse.json({ error: `Unknown type: ${type}` }, { status: 400 });
  }

  if (result.error) {
    return NextResponse.json({ error: result.error, data: [] }, { status: 502 });
  }

  return NextResponse.json({ data: result.data?.data ?? [] });
}
