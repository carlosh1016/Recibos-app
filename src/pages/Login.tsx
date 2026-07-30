import { useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button, Card, Field, Screen } from '../components'
import { login } from '../auth/authToken'

export function Login() {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const navigate = useNavigate()
  const [params] = useSearchParams()

  async function entrar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setEnviando(true)
    setError(null)
    try {
      await login(password)
      navigate(params.get('next') || '/', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo iniciar sesión')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Screen titulo="Recibos App" subtitulo="Ingresa la contraseña para continuar">
      <Card>
        <form onSubmit={(e) => void entrar(e)} className="flex flex-col gap-4">
          <Field
            label="Contraseña"
            type="password"
            autoComplete="current-password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            tono={error ? 'error' : 'normal'}
            ayuda={error}
          />
          <Button type="submit" fullWidth disabled={!password.trim() || enviando}>
            {enviando ? 'Entrando…' : 'Entrar'}
          </Button>
        </form>
      </Card>
    </Screen>
  )
}
