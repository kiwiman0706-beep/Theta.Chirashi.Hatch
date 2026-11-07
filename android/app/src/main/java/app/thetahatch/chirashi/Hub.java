package app.thetahatch.chirashi;

import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import org.json.JSONObject;

// The series hubs on this phone: Theta Home Hatch and Theta KidsHome Hatch
// (Theta.Hatch.Series spec/THETA_SHARED_SETTINGS.md §4.0–4.1, spec/THETA_HATCH_SPEC.md §6.1).
// - Settings: content://<hub>.theta/info (ui.skin, gemini.model, google.account …) and, when the
//   user chooses it, /secret/gemini.key. Protected by app.thetahatch.permission.SHARE
//   (signature: only apps signed with the series key).
// - Updates: this app has no install permission; "update" asks the hub
//   (app.thetahatch.action.UPDATE), or opens the Releases page when there is no hub.
public final class Hub {
  public static final String[] HUBS = {"app.thetahatch.home", "app.thetahatch.kidshome"};
  public static final String RELEASES = "https://github.com/kiwiman0706-beep/Theta.Chirashi.Hatch/releases/latest";

  private Hub() {}

  static boolean installed(Context c, String pkg) {
    try {
      c.getPackageManager().getPackageInfo(pkg, 0);
      return true;
    } catch (PackageManager.NameNotFoundException e) {
      return false;
    }
  }

  static String label(Context c, String pkg) {
    try {
      PackageManager pm = c.getPackageManager();
      return String.valueOf(pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)));
    } catch (Exception e) {
      return pkg;
    }
  }

  // Cursor → {key: value}. Either rows of (key, value[, at, by]) or one row whose columns are keys.
  static JSONObject read(Cursor q) throws Exception {
    JSONObject o = new JSONObject();
    if (q == null) return o;
    int k = q.getColumnIndex("key"), v = q.getColumnIndex("value");
    if (k >= 0 && v >= 0) {
      while (q.moveToNext()) if (q.getString(k) != null) o.put(q.getString(k), q.isNull(v) ? "" : q.getString(v));
    } else if (q.moveToFirst()) {
      for (int i = 0; i < q.getColumnCount(); i++) if (q.getType(i) != Cursor.FIELD_TYPE_BLOB) o.put(q.getColumnName(i), q.isNull(i) ? "" : q.getString(i));
    }
    return o;
  }

  // {hub, label, values:{…}} of the first hub that answers (Home first), or {} when none.
  public static JSONObject info(Context c) {
    for (String pkg : HUBS) {
      if (!installed(c, pkg)) continue;
      try (Cursor q = c.getContentResolver().query(Uri.parse("content://" + pkg + ".theta/info"), null, null, null, null)) {
        if (q == null) continue;
        return new JSONObject().put("hub", pkg).put("label", label(c, pkg)).put("values", read(q));
      } catch (Exception ignored) {
        // not signed with the series key, or a hub version without the provider
      }
    }
    return new JSONObject();
  }

  public static String secret(Context c, String hub, String key) throws Exception {
    if (!java.util.Arrays.asList(HUBS).contains(hub) || !key.matches("[a-z.]+")) throw new IllegalArgumentException("hub");
    try (Cursor q = c.getContentResolver().query(Uri.parse("content://" + hub + ".theta/secret/" + key), null, null, null, null)) {
      if (q == null || !q.moveToFirst()) throw new Exception(label(c, hub) + " から受け取れませんでした");
      int v = q.getColumnIndex("value");
      return q.getString(v >= 0 ? v : 0);
    }
  }

  // Writes back a setting changed here ("follow the series" items only).
  public static void writeBack(Context c, String hub, String key, String value) {
    try {
      ContentValues v = new ContentValues();
      v.put("key", key);
      v.put("value", value);
      v.put(key, value);
      v.put("by", "chirashi");
      v.put("at", new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", java.util.Locale.ROOT) {
        { setTimeZone(java.util.TimeZone.getTimeZone("UTC")); }
      }.format(new java.util.Date()));
      c.getContentResolver().update(Uri.parse("content://" + hub + ".theta/info"), v, null, null);
    } catch (Exception ignored) {
    }
  }

  // "Update": the hub's update screen for this app, or the Releases page.
  public static String update(Context c) {
    for (String pkg : HUBS) {
      if (!installed(c, pkg)) continue;
      try {
        c.startActivity(new Intent("app.thetahatch.action.UPDATE").setPackage(pkg).putExtra("packageName", c.getPackageName()).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        return label(c, pkg);
      } catch (Exception ignored) {
      }
    }
    c.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(RELEASES)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
    return "";
  }
}
