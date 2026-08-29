import {
  ContextType,
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback
} from 'react'
import { invoke } from '@tauri-apps/api/core'

export const userKey = (u: User) => u.minecraft.uuid

const AuthContext = createContext({
  authReady: false,
  user: null as User | null,
  loginWithMicrosoft: () => Promise.resolve(null as any),
  isWaiting: false,
  userList: [] as User[],
  selectUser: (_user: User) => {},
  removeUser: (_user: User) => {},
  logout: () => {},
  updateUser: (_user: User) => {},
  refreshMicrosoftToken: () => Promise.resolve(null as string | null),
})

export function AuthProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [authReady, setAuthReady] = useState(false)
  const [user, setUser] = useState<User | null>(null)
  const [isWaiting, setIsWaiting] = useState(false)
  const [userList, setUserList] = useState<User[]>([])

  const loginWithMicrosoft = async () => {
    setIsWaiting(true)
    try {
      const result = await invoke("login_microsoft") as User
      setUser(result)
      // Mantener lista de cuentas (para multi-cuenta / refresco futuro)
      setUserList(prev => {
        const key = userKey(result)
        const idx = prev.findIndex(u => userKey(u) === key)
        if (idx >= 0) {
          const copy = [...prev]
          copy[idx] = result
          return copy
        }
        return [...prev, result]
      })
      return result
    } catch (e) {
      console.error(e)
      throw e
    } finally {
      setIsWaiting(false)
    }
  }

  const init = async () => {
    try {
      let raw = await invoke<string | null>("get_auth_json")
      if (!raw) {
        const legacyUser = localStorage.getItem('userAuth')
        const legacyList = localStorage.getItem('userList')
        if (legacyUser || legacyList) {
          raw = JSON.stringify({
            user: legacyUser ? JSON.parse(legacyUser) : null,
            userList: legacyList ? JSON.parse(legacyList) : [],
          })
          await invoke("save_auth_json", { payload: raw }).catch(() => {})
          localStorage.removeItem('userAuth')
          localStorage.removeItem('userList')
        }
      }
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed.userList)) setUserList(parsed.userList)
        if (parsed.user) {
          // Refresh proactivo y BLOQUEANTE si el token está expirado o por expirar
          // Esto evita que el usuario vea la pantalla de Login un segundo y luego se restaure,
          // y garantiza que el token se persiste antes de marcar authReady.
          const exp = (parsed.user as any)?.minecraft?.expires_at
          const rt = (parsed.user as any)?.minecraft?.refresh_token
          const needsRefresh = typeof exp === 'number' && typeof rt === 'string' && rt.trim() !== '' && Date.now() > exp - 5 * 60 * 1000
          if (needsRefresh) {
            try {
              const result = await invoke<{ access_token: string; refresh_token: string; ms_access_token: string; expires_in?: number; ms_expires_in?: number }>(
                "refresh_microsoft_token",
                { refreshToken: rt }
              ) as any
              const now = Date.now()
              const mcExp = result.expires_in ? now + result.expires_in * 1000 : now + 24*3600*1000
              const msExp = result.ms_expires_in ? now + result.ms_expires_in * 1000 : undefined
              const updated = {
                ...parsed.user,
                minecraft: {
                  ...parsed.user.minecraft,
                  access_token: result.access_token,
                  refresh_token: result.refresh_token,
                  ms_access_token: result.ms_access_token,
                  expires_at: mcExp,
                  expires_in: result.expires_in,
                  ms_expires_at: msExp,
                  ms_expires_in: result.ms_expires_in,
                }
              }
              parsed.user = updated
              // Sincronizar userList con el token refrescado antes de setear estado
              if (Array.isArray(parsed.userList)) {
                const key = userKey(updated)
                parsed.userList = parsed.userList.map((u: User) => userKey(u) === key ? updated : u)
                setUserList(parsed.userList)
              }
              // Persistir inmediatamente el refresh para que el próximo arranque no repita el refresh
              await invoke("save_auth_json", { payload: JSON.stringify(parsed) }).catch(() => {})
            } catch (e) {
              console.warn("[auth] auto-refresh al iniciar falló (se usará token existente):", e)
            }
          }
          setUser(parsed.user)
        }
      }
    } catch (e) {
      console.error("Error cargando sesión:", e)
    }
    setAuthReady(true)
  }

  useEffect(() => {
    init()
  }, [])

  useEffect(() => {
    if (!authReady) return
    const payload = JSON.stringify({ user, userList })
    invoke("save_auth_json", { payload }).catch(console.error)
  }, [authReady, user, userList])

  const selectUser = (user: User) => setUser(user)

  const removeUser = useCallback((target: User) => {
    const key = userKey(target)
    const newList = userList.filter(u => userKey(u) !== key)
    setUserList(newList)
    setUser((cur) => {
      if (!cur || userKey(cur) !== key) return cur
      return newList[0] ?? null
    })
    // Si era la última cuenta, limpiar archivo en disco
    if (newList.length === 0) {
      invoke("clear_auth").catch(() => {})
    }
  }, [userList])

  const logout = useCallback(async () => {
    // Cerrar sesión de la cuenta actual: la quita de la lista y borra archivo si queda vacía
    // Esto evita que los tokens queden en disco tras "Cerrar sesión"
    if (user) {
      const key = userKey(user)
      const newList = userList.filter(u => userKey(u) !== key)
      setUserList(newList)
      setUser(null)
      try {
        if (newList.length === 0) {
          await invoke("clear_auth")
        } else {
          // persistir lista filtrada (el efecto también lo hace, pero forzamos)
          await invoke("save_auth_json", { payload: JSON.stringify({ user: null, userList: newList }) })
        }
      } catch {}
      // También notificar al backend
      invoke("logout").catch(() => {})
    } else {
      setUser(null)
      try { await invoke("clear_auth") } catch {}
    }
  }, [user, userList])

  const updateUser = useCallback((updated: User) => {
    setUser(updated)
    setUserList(prev => {
      const key = userKey(updated)
      const idx = prev.findIndex(u => userKey(u) === key)
      if (idx >= 0) {
        const copy = [...prev]
        copy[idx] = updated
        return copy
      }
      return [...prev, updated]
    })
  }, [])

  const refreshMicrosoftToken = useCallback(async (): Promise<string | null> => {
    if (!user || user.type !== 'microsoft') return null

    const refreshToken: string | undefined = (user as any)?.minecraft?.refresh_token
    if (!refreshToken || typeof refreshToken !== 'string' || refreshToken.trim() === '') {
      console.warn('[auth] refresh_token vacío — se omite refresh')
      return null
    }
    // Si el token de MC aún es válido (>5 min de vida), no refrescar innecesariamente
    const expiresAt: number | undefined = (user as any)?.minecraft?.expires_at
    if (typeof expiresAt === 'number' && Date.now() < expiresAt - 5 * 60 * 1000) {
      return user.minecraft.access_token
    }

    try {
      const result = await invoke<{ access_token: string; refresh_token: string; ms_access_token: string; expires_in?: number; ms_expires_in?: number; expires_at?: number }>(
        "refresh_microsoft_token",
        { refreshToken }
      )

      const now = Date.now()
      const mcExpires = result.expires_in ? now + result.expires_in * 1000 : now + 24 * 3600 * 1000
      const msExpires = result.ms_expires_in ? now + result.ms_expires_in * 1000 : undefined

      const updatedUser: User = {
        ...user,
        minecraft: {
          ...user.minecraft,
          access_token: result.access_token,
          refresh_token: result.refresh_token,
          ms_access_token: result.ms_access_token,
          // @ts-ignore expiry fields
          expires_at: mcExpires,
          expires_in: result.expires_in,
          ms_expires_at: msExpires,
          ms_expires_in: result.ms_expires_in,
        } as any
      }

      setUser(updatedUser)
      // Mantener userList sincronizado (evita que el token viejo quede guardado)
      setUserList(prev => {
        const key = userKey(updatedUser)
        const exists = prev.some(u => userKey(u) === key)
        if (exists) return prev.map(u => userKey(u) === key ? updatedUser : u)
        return [...prev, updatedUser]
      })
      return result.access_token
    } catch (e: any) {
      const msg = String(e ?? "")
      // Si el refresh indica sesión expirada, limpiar estado y forzar re-login
      if (msg.includes("Sesión expirada") || msg.includes("invalid_grant") || msg.includes("refresh_token inválido")) {
        console.warn("[auth] refresh expirado, limpiando sesión:", msg)
        // No auto-borramos archivo aquí para no perder otras cuentas; el caller decide toast + logout
      }
      console.error("Error refrescando token:", e)
      throw e
    }
  }, [user])

  return (
    <AuthContext.Provider value={{
      authReady,
      user,
      loginWithMicrosoft,
      isWaiting,
      userList,
      selectUser,
      removeUser,
      logout,
      updateUser,
      refreshMicrosoftToken,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): ContextType<typeof AuthContext> {
  return useContext(AuthContext)
}