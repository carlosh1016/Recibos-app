import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { isTokenValid } from './authToken'

// Guardia de ruta: protege el acceso a la app completa (no solo la ruta de
// IA), porque el pedido era "un login que solo le permita el uso de la app a
// mi mamá". No es un límite de seguridad real —el cliente nunca puede
// verificar la firma del token, solo si su fecha de expiración ya pasó— pero
// cumple el objetivo de acceso. La barrera real está en api/extract.ts.
export function RequireAuth() {
  const location = useLocation()

  if (!isTokenValid()) {
    const next = encodeURIComponent(location.pathname + location.search)
    return <Navigate to={`/login?next=${next}`} replace />
  }

  return <Outlet />
}
