import { betterAuth } from "better-auth"
import { prismaAdapter } from "better-auth/adapters/prisma"
import { prisma } from "./db"

function resolveAuthSecret() {
  const configured = process.env.BETTER_AUTH_SECRET?.trim()
  if (configured) return configured
  if (process.env.NODE_ENV === "production") {
    throw new Error("BETTER_AUTH_SECRET is required in production.")
  }
  return "goal-mate-local-development-secret-change-before-production"
}

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "sqlite",
  }),
  secret: resolveAuthSecret(),
  baseURL: process.env.BETTER_AUTH_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
  advanced: {
    cookiePrefix: "goal-mate",
    crossSubDomainCookies: {
      enabled: false,
    },
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    sendResetPassword: async () => undefined,
    sendVerificationEmail: async () => undefined,
  },
})
