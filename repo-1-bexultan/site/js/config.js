window.CAFE_CONFIG = Object.freeze({
  // "supabase" uses the live database; "demo" keeps orders in this browser only.
  defaultMode: "supabase",
  supabaseUrl: "https://ovzxxevqqvqfaeewskdm.supabase.co",
  supabasePublishableKey: "sb_publishable_s9ub3AU_6b0cfOY96ncKpg_rN6k4BqK",
  // Refresh intervals in milliseconds.
  poll: { queue: 30000, track: 8000, board: 5000, shelf: 2000 }
});
