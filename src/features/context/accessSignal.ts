import type { SupabaseClient } from "@supabase/supabase-js";

// Only an explicit PostgreSQL insufficient_privilege answer can start a
// revocation check. Network, version and state failures never do.
export function isAccessDenied(error: unknown): boolean {
  return !!error && typeof error === "object" && (error as { code?: unknown }).code === "42501";
}

// Every context-bound read and command reaches the backend through rpc with a
// p_contexto argument. Observing the result here covers all consumers without
// changing how each one reports its own error.
export function withAccessDeniedSignal(client: SupabaseClient, onDenied: () => void): SupabaseClient {
  return new Proxy(client, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property, target);
      if (property !== "rpc") return typeof value === "function" ? value.bind(target) : value;
      return (name: string, args?: Record<string, unknown>, options?: Record<string, unknown>) => {
        const request = target.rpc(name, args, options as never);
        if (!args || !("p_contexto" in args)) return request;
        return {
          then(onFulfilled?: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
            return Promise.resolve(request).then((result) => {
              if (isAccessDenied((result as { error?: unknown }).error)) onDenied();
              return result;
            }).then(onFulfilled, onRejected);
          },
        };
      };
    },
  });
}
