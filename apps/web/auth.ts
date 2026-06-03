/**
 * NextAuth v5 (next-auth@beta) 設定
 *
 * 需要的環境變數（在 .env.local 或 Render 後台設定）：
 *   AUTH_SECRET        = 隨機 32+ 字元字串（執行 `npx auth secret` 產生）
 *   AUTH_GOOGLE_ID     = OAuth Client ID（來自 Google Cloud Console）
 *   AUTH_GOOGLE_SECRET = OAuth Client Secret
 *
 * 登入後 session.user.id = Google 帳號的唯一 sub，用來取代 localStorage UUID
 * 讓使用者在不同裝置/清除快取後仍能存取自選股與提醒設定。
 */

import NextAuth from "next-auth";
import Google   from "next-auth/providers/google";

export const { handlers, signIn, signOut, auth } = NextAuth({
  // Render / reverse-proxy 環境需要 trustHost，否則 OAuth callback URL 會出錯
  // （NextAuth v5 預設只信任 AUTH_URL，部署在 Render 時必須明確開啟）
  trustHost: true,
  providers: [
    Google({
      clientId:     process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
    }),
  ],
  callbacks: {
    jwt({ token, account, profile }) {
      // 第一次登入時把 Google sub 存到 token
      if (account?.provider === "google" && profile?.sub) {
        token.googleId = profile.sub;
      }
      return token;
    },
    session({ session, token }) {
      // 把 googleId 帶到 session，供 client 端讀取
      if (token.googleId) {
        session.user.id = token.googleId as string;
      }
      return session;
    },
  },
  pages: {
    signIn: "/",   // 登入失敗重導首頁
  },
});
