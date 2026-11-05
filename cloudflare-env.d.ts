declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    MONITOR_SESSION_SECRET?: string;
    MONITOR_ADMIN_HASH?: string;
    MONITOR_GUEST_HASH?: string;
    MONITOR_GUEST_BATCH_ID?: string;
    MONITOR_PUBLIC_ORIGIN?: string;
    CLOUD_ENDPOINT?: string;
    CLOUD_PUBLISHABLE_KEY?: string;
  }
}
