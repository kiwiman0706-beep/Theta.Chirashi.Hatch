package jp.yaegaki.theta.chirashi;

import android.content.Context;
import android.net.Uri;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;
import org.json.JSONArray;
import org.json.JSONObject;

// Moving the app's data to another install (the series migration: docs/MIGRATION.md §3 of
// Theta.Hatch.Series). One zip:
//   manifest.json  {"app":"chirashi","format":"chirashi-export@1","version":…,"exportedAt":…,"records":n,"images":n}
//   data.json      the records and settings (no secrets: the Gemini key is never written)
//   media/<name>   the flyer pictures
// Import merges: a record already here (same id) is kept unless the incoming one is newer.
public final class Transfer {
  public static final String FORMAT = "chirashi-export@1";
  // Bumped after an import, so the open screen reloads its records.
  public static final AtomicInteger generation = new AtomicInteger();

  private Transfer() {}

  static File dataFile(Context c) {
    return new File(c.getFilesDir(), "chirashi.json");
  }

  static File mediaDir(Context c) {
    File d = new File(c.getFilesDir(), "media");
    d.mkdirs();
    return d;
  }

  static String read(InputStream in) throws Exception {
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    copy(in, out);
    return out.toString("UTF-8");
  }

  static void copy(InputStream in, OutputStream out) throws Exception {
    byte[] buf = new byte[65536];
    for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
  }

  static JSONObject load(Context c) throws Exception {
    File f = dataFile(c);
    if (!f.exists()) return new JSONObject().put("version", 1).put("records", new JSONArray()).put("settings", new JSONObject());
    try (InputStream in = new FileInputStream(f)) {
      JSONObject db = new JSONObject(read(in));
      if (!db.has("records")) db.put("records", new JSONArray());
      if (!db.has("settings")) db.put("settings", new JSONObject());
      return db;
    }
  }

  static void store(Context c, JSONObject db) throws Exception {
    File tmp = new File(c.getFilesDir(), "chirashi.json.tmp");
    try (OutputStream out = new FileOutputStream(tmp)) {
      out.write(db.toString().getBytes("UTF-8"));
    }
    File f = dataFile(c);
    File bak = new File(c.getFilesDir(), "chirashi.json.bak");
    if (f.exists()) {
      bak.delete();
      f.renameTo(bak);
    }
    if (!tmp.renameTo(f)) throw new Exception("保存できませんでした");
  }

  // {records, images} for the confirmation text.
  public static int[] counts(Context c) throws Exception {
    JSONArray recs = load(c).getJSONArray("records");
    int images = 0;
    for (int i = 0; i < recs.length(); i++) {
      JSONArray p = recs.getJSONObject(i).optJSONArray("pages");
      if (p != null) images += p.length();
    }
    return new int[] {recs.length(), images};
  }

  public static File export(Context c) throws Exception {
    JSONObject db = load(c);
    JSONArray recs = db.getJSONArray("records");
    Set<String> names = new HashSet<>();
    for (int i = 0; i < recs.length(); i++) {
      JSONArray p = recs.getJSONObject(i).optJSONArray("pages");
      if (p != null) for (int k = 0; k < p.length(); k++) names.add(p.getJSONObject(k).optString("name"));
    }
    String version = c.getPackageManager().getPackageInfo(c.getPackageName(), 0).versionName;
    String stamp = new SimpleDateFormat("yyyyMMdd-HHmm", Locale.ROOT).format(new Date());
    File dir = new File(c.getCacheDir(), "share");
    dir.mkdirs();
    File[] old = dir.listFiles();
    if (old != null) for (File f : old) if (f.getName().startsWith("chirashi-export-")) f.delete();
    File zip = new File(dir, "chirashi-export-" + stamp + ".zip");
    int images = 0;
    try (ZipOutputStream z = new ZipOutputStream(new FileOutputStream(zip))) {
      for (String n : names) {
        File f = new File(mediaDir(c), n);
        if (!n.matches("[A-Za-z0-9_.-]{1,200}") || !f.exists()) continue;
        z.putNextEntry(new ZipEntry("media/" + n));
        try (InputStream in = new FileInputStream(f)) {
          copy(in, z);
        }
        z.closeEntry();
        images++;
      }
      z.putNextEntry(new ZipEntry("data.json"));
      z.write(db.toString().getBytes("UTF-8"));
      z.closeEntry();
      JSONObject m = new JSONObject()
          .put("app", "chirashi")
          .put("format", FORMAT)
          .put("from", c.getPackageName())
          .put("version", version)
          .put("exportedAt", new Date().getTime())
          .put("records", recs.length())
          .put("images", images);
      z.putNextEntry(new ZipEntry("manifest.json"));
      z.write(m.toString(1).getBytes("UTF-8"));
      z.closeEntry();
    }
    return zip;
  }

  // Returns {records added or updated, images}.
  public static int[] importZip(Context c, Uri uri) throws Exception {
    JSONObject manifest = null, incoming = null;
    File stage = new File(c.getCacheDir(), "import");
    stage.mkdirs();
    File[] old = stage.listFiles();
    if (old != null) for (File f : old) f.delete();
    int images = 0;
    try (InputStream raw = c.getContentResolver().openInputStream(uri); ZipInputStream z = new ZipInputStream(raw)) {
      for (ZipEntry e; (e = z.getNextEntry()) != null; ) {
        String n = e.getName();
        if (n.equals("manifest.json")) manifest = new JSONObject(read(z));
        else if (n.equals("data.json")) incoming = new JSONObject(read(z));
        else if (n.startsWith("media/") && n.substring(6).matches("[A-Za-z0-9_.-]{1,200}") && !n.contains("..")) {
          try (OutputStream out = new FileOutputStream(new File(stage, n.substring(6)))) {
            copy(z, out);
          }
        }
      }
    }
    if (manifest == null || !"chirashi".equals(manifest.optString("app")) || incoming == null)
      throw new Exception("Theta Chirashi Hatch の書き出しファイルではありません");
    JSONObject db = load(c);
    JSONArray mine = db.getJSONArray("records");
    JSONArray theirs = incoming.optJSONArray("records");
    int changed = 0;
    if (theirs != null) {
      for (int i = 0; i < theirs.length(); i++) {
        JSONObject r = theirs.getJSONObject(i);
        // Drive copies belong to the old app (drive.file): upload again from the new one.
        r.remove("driveId");
        JSONArray pages = r.optJSONArray("pages");
        if (pages != null)
          for (int k = 0; k < pages.length(); k++) {
            pages.getJSONObject(k).remove("driveId");
            pages.getJSONObject(k).remove("driveLink");
          }
        if ("reading".equals(r.optString("status"))) r.put("status", "error").put("error", "読み取りの途中で書き出されました");
        int at = -1;
        for (int k = 0; k < mine.length(); k++) if (mine.getJSONObject(k).optString("id").equals(r.optString("id"))) at = k;
        if (at < 0) {
          mine.put(r);
          changed++;
        } else if (r.optString("updatedAt").compareTo(mine.getJSONObject(at).optString("updatedAt")) > 0) {
          mine.put(at, r);
          changed++;
        }
      }
    }
    // Settings: only what this install has not set itself. The Drive folder is the old app's.
    JSONObject s = db.getJSONObject("settings");
    JSONObject is = incoming.optJSONObject("settings");
    if (is != null)
      for (String k : new String[] {"model", "email", "calendarId", "calendarName"})
        if (s.optString(k).isEmpty() && !is.optString(k).isEmpty()) s.put(k, is.optString(k));
    File[] got = stage.listFiles();
    if (got != null)
      for (File f : got) {
        File dst = new File(mediaDir(c), f.getName());
        if (!dst.exists()) {
          if (!f.renameTo(dst))
            try (InputStream in = new FileInputStream(f); OutputStream out = new FileOutputStream(dst)) {
              copy(in, out);
            }
          images++;
        }
        f.delete();
      }
    store(c, db);
    generation.incrementAndGet();
    return new int[] {changed, images};
  }
}
