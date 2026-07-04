import { createAuthClient } from "better-auth/react"

const authBaseURL =
  process.env.NEXT_PUBLIC_BETTER_AUTH_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  (typeof window !== "undefined" ? window.location.origin : "http://localhost:3000")

export const authClient = createAuthClient({
  baseURL: authBaseURL,
  fetchOptions: {
    credentials: "include",
  },
})

export const { signIn, signUp, signOut, useSession } = authClient
