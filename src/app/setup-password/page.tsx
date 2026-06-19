import type { CSSProperties } from "react";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default function SetupPasswordPage({
  searchParams
}: {
  searchParams?: { token?: string; error?: string };
}) {
  const token = searchParams?.token ?? "";
  const error = searchParams?.error;

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 24,
        background: "linear-gradient(180deg, #f4f7fb 0%, #edf5f1 100%)"
      }}
    >
      <section
        style={{
          width: "min(440px, 100%)",
          padding: 28,
          borderRadius: 8,
          border: "1px solid #d8dee8",
          background: "#ffffff",
          boxShadow: "0 18px 48px rgba(23,32,51,0.12)"
        }}
      >
        <h1 style={{ margin: 0, fontSize: 28 }}>设置密码</h1>
        <p style={{ color: "#687386", marginTop: 10 }}>请输入新密码。链接只能使用一次，完成后已有会话会失效。</p>
        {error ? <div style={errorStyle}>{passwordErrorText(error)}</div> : null}
        {token ? (
          <form method="post" action="/api/auth/set-password" style={{ display: "grid", gap: 12, marginTop: 20 }}>
            <input name="token" type="hidden" value={token} />
            <label style={{ display: "grid", gap: 6 }}>
              <span>新密码</span>
              <input data-testid="setup-password-input" name="password" type="password" minLength={8} required style={inputStyle} />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>确认密码</span>
              <input data-testid="setup-password-confirm" name="passwordConfirm" type="password" minLength={8} required style={inputStyle} />
            </label>
            <button data-testid="setup-password-submit" type="submit" style={buttonStyle}>
              保存密码
            </button>
          </form>
        ) : (
          <div style={{ marginTop: 20 }}>
            <Link href="/login">返回登录</Link>
          </div>
        )}
      </section>
    </main>
  );
}

function passwordErrorText(error: string): string {
  if (error === "weak") return "密码至少需要 8 个字符。";
  if (error === "mismatch") return "两次输入的密码不一致。";
  return "密码设置链接无效、已使用或已过期。";
}

const inputStyle: CSSProperties = {
  minHeight: 40,
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid #d8dee8"
};

const buttonStyle: CSSProperties = {
  minHeight: 42,
  border: 0,
  borderRadius: 8,
  color: "#ffffff",
  background: "#0f766e"
};

const errorStyle: CSSProperties = {
  marginTop: 16,
  padding: 10,
  borderRadius: 8,
  color: "#8a1f11",
  background: "#fff1ed",
  border: "1px solid #ffd4c7"
};
