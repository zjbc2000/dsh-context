/** The host `connection` service seam every plugin fetch route registers through; one home for the face and the bind-at-extraction guard
 * (an unbound hand-off loses `this` on the real face). */

export interface ConnectionHostFace {
  fetch?: {
    register?(route: {
      path: string
      methods: readonly string[]
      requestBody: 'buffered'
      fetch: (request: Request) => Response | Promise<Response>
    }): () => void
  }
}

function fetchRouteRegistrar(connection: ConnectionHostFace | undefined) {
  return typeof connection?.fetch?.register === 'function'
    ? connection.fetch.register.bind(connection.fetch)
    : undefined
}

interface EffectScope {
  effect(effect: () => () => void, hint?: string): unknown
}

/**
 * Register one plugin fetch route: every route is a POST behind the same `/api` fence, so the shape, the
 * bind-at-extraction guard and the refuse-quietly catch live here. Returns false when the face is absent or the
 * registry refuses.
 */
export function registerPostRoute(
  c: EffectScope,
  connection: ConnectionHostFace | undefined,
  path: string,
  fetch: (request: Request) => Response | Promise<Response>,
  label: string,
): boolean {
  const register = fetchRouteRegistrar(connection)
  if (register === undefined) return false
  try {
    c.effect(() => register({ path, methods: ['POST'], requestBody: 'buffered', fetch }), label)
  } catch {
    return false
  }
  return true
}
