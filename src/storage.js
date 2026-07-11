import { supabase } from "./supabaseClient";

// One JSON blob per user, exposing the same API the app used as an artifact.
export function makeStorage(userId) {
  let cache = null;

  async function load() {
    if (cache) return cache;
    const { data, error } = await supabase
      .from("app_data").select("data").eq("user_id", userId).maybeSingle();
    if (error) throw error;
    cache = data?.data || {};
    return cache;
  }
  async function persist() {
    const { error } = await supabase.from("app_data")
      .upsert({ user_id: userId, data: cache, updated_at: new Date().toISOString() });
    if (error) throw error;
  }

  return {
    async get(key) { const c = await load(); return key in c ? { key, value: c[key] } : null; },
    async set(key, value) { const c = await load(); c[key] = value; await persist(); return { key, value }; },
    async delete(key) { const c = await load(); delete c[key]; await persist(); return { key, deleted: true }; },
    async list(prefix = "") { const c = await load(); return { keys: Object.keys(c).filter((k) => k.startsWith(prefix)) }; },
  };
}