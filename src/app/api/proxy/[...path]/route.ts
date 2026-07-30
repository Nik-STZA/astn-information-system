/**
 * Catch-all API proxy to Cloud Run.
 *
 * Client components cannot access the Cloud Run API key (non-NEXT_PUBLIC env var),
 * so they call /api/proxy/<path> and this route handler forwards the request
 * with the API key attached.
 *
 * Supports GET, POST, PUT, PATCH, DELETE.
 */

import { NextRequest, NextResponse } from "next/server";

const API_BASE =
  process.env.CLOUD_RUN_API_URL ||
  "https://africastn-api-782190795609.europe-west1.run.app";

const API_KEY = process.env.CLOUD_RUN_API_KEY;

function headers(): HeadersInit {
  return {
    "Content-Type": "application/json",
    ...(API_KEY ? { "X-API-Key": API_KEY } : {}),
  };
}

async function proxyRequest(req: NextRequest, path: string) {
  const url = new URL(req.url);
  const target = `${API_BASE}/api/${path}${url.search}`;

  const init: RequestInit = {
    method: req.method,
    headers: headers(),
    cache: "no-store",
  };

  // Forward body for non-GET methods
  if (req.method !== "GET" && req.method !== "HEAD") {
    try {
      const body = await req.text();
      if (body) init.body = body;
    } catch {
      // no body
    }
  }

  try {
    const res = await fetch(target, init);
    const data = await res.text();

    return new NextResponse(data, {
      status: res.status,
      headers: { "Content-Type": res.headers.get("Content-Type") || "application/json" },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Proxy error" },
      { status: 502 }
    );
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  return proxyRequest(req, path.join("/"));
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  return proxyRequest(req, path.join("/"));
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  return proxyRequest(req, path.join("/"));
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  return proxyRequest(req, path.join("/"));
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  return proxyRequest(req, path.join("/"));
}
