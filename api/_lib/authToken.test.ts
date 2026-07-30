import { describe, expect, it } from 'vitest'
import { signToken, verificarPassword, verifyToken } from './authToken'

describe('authToken', () => {
  const secreto = 'secreto-de-prueba'

  it('un token recién firmado verifica válido', async () => {
    const token = await signToken(secreto, Date.now() + 60_000)
    expect(await verifyToken(token, secreto)).toBe(true)
  })

  it('un token expirado no verifica aunque la firma sea correcta', async () => {
    const token = await signToken(secreto, Date.now() - 1_000)
    expect(await verifyToken(token, secreto)).toBe(false)
  })

  it('una firma alterada no verifica', async () => {
    const token = await signToken(secreto, Date.now() + 60_000)
    const alterado = token.slice(0, -1) + (token.endsWith('0') ? '1' : '0')
    expect(await verifyToken(alterado, secreto)).toBe(false)
  })

  it('un token firmado con otro secreto no verifica', async () => {
    const token = await signToken(secreto, Date.now() + 60_000)
    expect(await verifyToken(token, 'otro-secreto')).toBe(false)
  })

  it('un formato inválido no verifica', async () => {
    expect(await verifyToken('esto-no-es-un-token', secreto)).toBe(false)
    expect(await verifyToken('', secreto)).toBe(false)
    expect(await verifyToken('123.no-es-hex', secreto)).toBe(false)
  })

  it('verificarPassword acepta la contraseña correcta y rechaza otras', async () => {
    expect(await verificarPassword('correcta', 'correcta', secreto)).toBe(true)
    expect(await verificarPassword('incorrecta', 'correcta', secreto)).toBe(false)
    expect(await verificarPassword('', 'correcta', secreto)).toBe(false)
  })
})
