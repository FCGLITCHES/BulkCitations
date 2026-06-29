import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { ADMIN_AUTH_SESSION_EVENT, USER_AUTH_SESSION_EVENT } from "@/lib/userAuthEvents";

const INVALIDATE_DEBOUNCE_MS = 250;

/**
 * Keeps TanStack Query caches aligned with auth — mounted admin and API views refetch after sign-in/out.
 */
export function AuthStateSync() {
  const queryClient = useQueryClient();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const invalidate = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        void queryClient.invalidateQueries({
          predicate: (q) => {
            const key = q.queryKey[0];
            if (typeof key !== "string") {
              return false;
            }
            return (
              key.startsWith("/api/")
              || key.startsWith("/internal/")
              || key.startsWith("/v1/")
            );
          },
        });
      }, INVALIDATE_DEBOUNCE_MS);
    };

    window.addEventListener(USER_AUTH_SESSION_EVENT, invalidate);
    window.addEventListener(ADMIN_AUTH_SESSION_EVENT, invalidate);
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      window.removeEventListener(USER_AUTH_SESSION_EVENT, invalidate);
      window.removeEventListener(ADMIN_AUTH_SESSION_EVENT, invalidate);
    };
  }, [queryClient]);

  return null;
}
