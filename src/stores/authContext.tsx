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
        if (parsed.user) setUser(parsed.user)
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
  }, [userList])

  const logout = useCallback(() => {
    setUser(null)
  }, [])

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

    const refreshToken = (user as any)?.minecraft?.refresh_token
    if (!refreshToken) return null

    try {
      const result = await invoke<{ access_token: string; refresh_token: string; ms_access_token: string }>(
        "refresh_microsoft_token",
        { refresh_token: refreshToken }
      )

      const updatedUser: User = {
        ...user,
        minecraft: {
          ...user.minecraft,
          access_token: result.access_token,
          refresh_token: result.refresh_token,
          ms_access_token: result.ms_access_token,
        }
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
    } catch (e) {
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