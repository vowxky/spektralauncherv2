import { useState } from "react";
import { useAuth } from "../stores/authContext";
import Ms from "../components/icons/Ms";
import UserHead from "../components/icons/UserHead";
import defaultBackground from "../assets/modstack-default.jpg";

const C = {
  fg: "#eeeef0",
  fgMuted: "#9a9aab",
} as const;

export default function Login() {
  const { loginWithMicrosoft, isWaiting } = useAuth();
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async () => {
    setError(null);
    try {
      await loginWithMicrosoft();
    } catch (e: any) {
      setError(e?.toString() ?? "No se pudo iniciar sesión. Intenta de nuevo.");
    }
  };

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        background: "#07070a",
        color: C.fg,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'Inter', sans-serif",
      }}
    >
      <img
        aria-hidden
        src={defaultBackground}
        alt=""
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          animation: "login-zoom 14s ease-out forwards",
        }}
      />
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(180deg, rgba(7,7,10,0.66) 0%, rgba(7,7,10,0.30) 45%, rgba(7,7,10,0.92) 100%)",
        }}
      />
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse 64% 58% at 50% 50%, transparent 0%, rgba(7,7,10,0.5) 100%)",
        }}
      />
      <div
        aria-hidden
        style={{
          position: "absolute",
          top: "-16%",
          left: "4%",
          width: 460,
          height: 460,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(0,164,239,0.14) 0%, transparent 62%)",
          filter: "blur(26px)",
          animation: "login-glow 9s ease-in-out infinite",
        }}
      />
      <div
        aria-hidden
        style={{
          position: "absolute",
          bottom: "-18%",
          right: "2%",
          width: 500,
          height: 500,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(242,80,34,0.10) 0%, transparent 62%)",
          filter: "blur(26px)",
          animation: "login-glow 11s ease-in-out -3s infinite",
        }}
      />

      <div style={{ position: "relative", zIndex: 1, animation: "login-rise 380ms ease-out" }}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 20,
              width: 380,
              padding: "44px 40px 36px",
              borderRadius: 20,
              border: "1px solid rgba(255,255,255,0.16)",
              background:
                "linear-gradient(180deg, rgba(30,30,40,0.94) 0%, rgba(15,15,20,0.97) 55%, rgba(9,9,12,0.99) 100%)",
              backdropFilter: "blur(24px)",
              WebkitBackdropFilter: "blur(24px)",
              boxShadow:
                "0 40px 90px -30px rgba(0,0,0,0.98), 0 12px 32px -14px rgba(0,0,0,0.85), inset 0 1px 0 rgba(255,255,255,0.12), inset 0 -40px 60px -40px rgba(0,0,0,0.7)",
              textAlign: "center",
            }}
          >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 64,
              height: 64,
              borderRadius: 16,
              overflow: "hidden",
              background: "linear-gradient(180deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.03) 100%)",
              border: "1px solid rgba(255,255,255,0.12)",
              boxShadow: "0 12px 32px -14px rgba(0,0,0,0.9), inset 0 1px 0 rgba(255,255,255,0.08)",
            }}
          >
            <UserHead style={{ width: 36, height: 36 }} />
          </div>

          <h1
            style={{
              margin: 0,
              fontSize: 26,
              fontWeight: 650,
              letterSpacing: "-0.01em",
              lineHeight: 1.2,
            }}
          >
            Inicia sesión
          </h1>

          <button
            onClick={handleLogin}
            disabled={isWaiting}
            style={{
              marginTop: 4,
              width: "100%",
              height: 52,
              borderRadius: 13,
              border: "1px solid rgba(255,255,255,0.14)",
              background: "linear-gradient(180deg, #1d1d24 0%, #141419 100%)",
              boxShadow:
                "0 10px 24px -12px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.07)",
              color: C.fg,
              fontSize: 15,
              fontWeight: 700,
              cursor: isWaiting ? "not-allowed" : "pointer",
              opacity: isWaiting ? 0.6 : 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              transition:
                "border-color 180ms ease, box-shadow 180ms ease, filter 180ms ease, opacity 180ms ease, transform 180ms ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "rgba(255,255,255,0.3)";
              e.currentTarget.style.boxShadow =
                "0 10px 30px -12px rgba(0,0,0,0.85), 0 0 0 4px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.1)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "rgba(255,255,255,0.14)";
              e.currentTarget.style.boxShadow =
                "0 10px 24px -12px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.07)";
            }}
          >
            {isWaiting ? (
              <>
                <span
                  style={{
                    width: 16,
                    height: 16,
                    border: "2px solid rgba(255,255,255,0.25)",
                    borderTopColor: "#ffffff",
                    borderRadius: "50%",
                    animation: "login-spin 700ms linear infinite",
                  }}
                />
                Esperando navegador...
              </>
            ) : (
              <>
                <Ms style={{ width: 20, height: 20 }} />
                Continuar con Microsoft
              </>
            )}
          </button>

          {error && (
            <div
              style={{
                width: "100%",
                padding: "10px 14px",
                borderRadius: 10,
                border: "1px solid rgba(239,154,154,0.25)",
                background: "rgba(239,154,154,0.08)",
                color: "#f0b3b3",
                fontSize: 12.5,
                lineHeight: 1.5,
                textAlign: "left",
              }}
            >
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
