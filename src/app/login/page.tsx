import type { CSSProperties } from "react";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getSessionUserId, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { demoCredentials } from "@/lib/crm/seed";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams?: { error?: string; password?: string } }) {
  const token = cookies().get(SESSION_COOKIE_NAME)?.value;
  if (token) {
    const sessionUserId = await getSessionUserId(token);
    if (sessionUserId) {
      redirect("/");
    }
  }

  const showDemoCredentials = process.env.NODE_ENV !== "production";

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 24,
        background:
          "radial-gradient(circle at top left, rgba(15,118,110,0.18), transparent 35%), linear-gradient(180deg, #f2f7f6 0%, #eef3f8 100%)"
      }}
    >
      <section
        style={{
          width: "min(420px, 100%)",
          padding: 28,
          borderRadius: 8,
          border: "1px solid #d8dee8",
          background: "#ffffff",
          boxShadow: "0 18px 48px rgba(23,32,51,0.12)"
        }}
      >
        <h1 style={{ margin: 0, fontSize: 30 }}>AI Agent CRM</h1>
        <p style={{ color: "#687386", marginTop: 10 }}>登录后进入销售 CRM 工作台。</p>
        {searchParams?.password === "updated" ? <div style={successStyle}>密码已更新，请使用新密码登录。</div> : null}
        {searchParams?.error === "invalid" ? <div style={errorStyle}>邮箱或密码不正确，或账号已被停用。</div> : null}
        {searchParams?.error === "rate_limited" ? <div style={errorStyle}>登录失败次数过多，请稍后再试。</div> : null}
        <form method="post" action="/api/auth/login" style={{ display: "grid", gap: 12, marginTop: 20 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span>邮箱</span>
            <input name="email" type="email" defaultValue={showDemoCredentials ? demoCredentials.admin.email : undefined} required style={inputStyle} />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span>密码</span>
            <input
              name="password"
              type="password"
              defaultValue={showDemoCredentials ? demoCredentials.admin.password : undefined}
              required
              style={inputStyle}
            />
          </label>
          <button
            type="submit"
            style={{
              minHeight: 42,
              border: 0,
              borderRadius: 8,
              color: "#ffffff",
              background: "#0f766e"
            }}
          >
            登录
          </button>
        </form>
        {showDemoCredentials ? (
          <div style={{ marginTop: 18, color: "#687386", fontSize: 14 }}>
            <div>管理员: {demoCredentials.admin.email} / {demoCredentials.admin.password}</div>
            <div>销售: {demoCredentials.sales.email} / {demoCredentials.sales.password}</div>
          </div>
        ) : null}
      </section>
    </main>
  );
}

const inputStyle: CSSProperties = {
  minHeight: 40,
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid #d8dee8"
};

const successStyle: CSSProperties = {
  marginTop: 16,
  padding: 10,
  borderRadius: 8,
  color: "#0f5132",
  background: "#eaf7ef",
  border: "1px solid #bfe5cc"
};

const errorStyle: CSSProperties = {
  marginTop: 16,
  padding: 10,
  borderRadius: 8,
  color: "#8a1f11",
  background: "#fff1ed",
  border: "1px solid #ffd4c7"
};
