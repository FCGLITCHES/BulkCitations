import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { resolveEngineApiUrl } from "./engine-api-base";
import { buildEngineApiHttpError, buildEngineApiNetworkError } from "./engine-api-errors";
import {
  getExternalAuthToken,
  getOAuthRuntimeSnapshot,
  waitForOAuthAccessToken,
} from "@/oauth/runtime";

async function throwIfResNotOk(res: Response, url: string) {
  if (!res.ok) {
    throw await buildEngineApiHttpError(res, url);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
  options: {
    headers?: HeadersInit;
  } = {},
): Promise<Response> {
  const requestUrl = resolveEngineApiUrl(url);
  const token = await resolveEngineMutationToken(method, url);
  const buildHeaders = (authToken: string | null): HeadersInit => ({
    ...(data ? { "Content-Type": "application/json" } : {}),
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    ...(options.headers ?? {}),
  });

  try {
    let res = await fetch(requestUrl, {
      method,
      headers: buildHeaders(token),
      body: data ? JSON.stringify(data) : undefined,
      credentials: "include",
    });

    if (res.status === 429 && !token && shouldRetryEngineRequestWithAuth(method, url)) {
      const retryToken = await waitForOAuthAccessToken();
      if (retryToken) {
        res = await fetch(requestUrl, {
          method,
          headers: buildHeaders(retryToken),
          body: data ? JSON.stringify(data) : undefined,
          credentials: "include",
        });
      }
    }

    await throwIfResNotOk(res, requestUrl);
    return res;
  } catch (error) {
    if (error instanceof TypeError) {
      throw buildEngineApiNetworkError(requestUrl, error);
    }

    throw error;
  }
}

async function resolveEngineMutationToken(method: string, url: string): Promise<string | null> {
  const token = await getExternalAuthToken();
  if (token || !shouldRetryEngineRequestWithAuth(method, url)) {
    return token;
  }

  const authSnapshot = getOAuthRuntimeSnapshot();
  const authRuntimeStillResolving = !authSnapshot.clerkLoaded || authSnapshot.workosLoading;
  const authRuntimeHasSession = authSnapshot.clerkSignedIn || authSnapshot.workosHasUser;

  if (authRuntimeHasSession || authRuntimeStillResolving) {
    return await waitForOAuthAccessToken();
  }

  return null;
}

function shouldRetryEngineRequestWithAuth(method: string, url: string): boolean {
  const normalizedMethod = method.toUpperCase();
  return normalizedMethod !== "GET" && url.startsWith("/api/engine/");
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const token = await getExternalAuthToken();
    const res = await fetch(queryKey[0] as string, {
      credentials: "include",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res, queryKey[0] as string);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
