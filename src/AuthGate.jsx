import { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";
import { makeStorage } from "./storage";
import FundTracker from "./FundTracker";

export default function AuthGate() {
  const [session, setSession] = useState(null);
  const [ready, setReady] = useState(false);
  const [storageReady, setStorageReady] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState("signin");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session) { window.storage = makeStorage(session.user.id); setStorageReady(true); }
    else setStorageReady(false);
  }, [session]);

  const submit = async () => {
    setMsg("");
    const { error } = mode === "signin"
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password });
    if (error) setMsg(error.message);
    else if (mode === "signup") setMsg("Account created — you can sign in now.");
  };

  if (!ready) return <p style={{ padding: 24, fontFamily: "sans-serif" }}>Loading…</p>;

  if (!session) {
    return (
      <div style={{ maxWidth: 320, margin: "60px auto", fontFamily: "sans-serif", display: "flex", flexDirection: "column", gap: 10 }}>
        <h2>Fund Tracker</h2>
        <input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} style={inp} />
        <input placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={inp} />
        <button onClick={submit} style={btn}>{mode === "signin" ? "Sign in" : "Create account"}</button>
        <button onClick={() => setMode(mode === "signin" ? "signup" : "signin")} style={{ background: "none", border: "none", color: "#4FB89A", cursor: "pointer" }}>
          {mode === "signin" ? "Need an account? Sign up" : "Have an account? Sign in"}
        </button>
        {msg && <p style={{ color: "#666", fontSize: 13 }}>{msg}</p>}
      </div>
    );
  }

  if (!storageReady) return <p style={{ padding: 24 }}>Loading…</p>;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", padding: "6px 10px" }}>
        <button onClick={() => supabase.auth.signOut()} style={{ ...btn, padding: "4px 10px" }}>Sign out</button>
      </div>
      <FundTracker key={session.user.id} />
    </div>
  );
}

const inp = { padding: 10, borderRadius: 8, border: "1px solid #ccc", fontSize: 14 };
const btn = { padding: 10, borderRadius: 8, border: "none", background: "#4FB89A", color: "#0E1413", fontWeight: 600, cursor: "pointer" };