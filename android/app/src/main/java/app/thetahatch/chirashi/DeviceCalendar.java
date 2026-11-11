package app.thetahatch.chirashi;

import android.Manifest;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Context;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.provider.CalendarContract.Calendars;
import android.provider.CalendarContract.Events;
import java.io.IOException;
import org.json.JSONArray;
import org.json.JSONObject;

// The phone's own calendar (CalendarContract): the event goes straight into a Google calendar on
// this phone, which Android syncs to Google Calendar, and other apps (Theta Home Hatch's schedule
// tab) see it at once. No Google Cloud setup; no pictures (those need the Calendar API).
public final class DeviceCalendar {
  private DeviceCalendar() {}

  public static boolean allowed(Context c) {
    return c.checkSelfPermission(Manifest.permission.READ_CALENDAR) == PackageManager.PERMISSION_GRANTED
        && c.checkSelfPermission(Manifest.permission.WRITE_CALENDAR) == PackageManager.PERMISSION_GRANTED;
  }

  // Writable calendars of Google accounts (then any writable one): [{id, name, account, primary, owner}].
  public static JSONArray calendars(Context c) throws Exception {
    JSONArray out = new JSONArray();
    try (Cursor q = c.getContentResolver().query(
        Calendars.CONTENT_URI,
        new String[] {Calendars._ID, Calendars.CALENDAR_DISPLAY_NAME, Calendars.ACCOUNT_NAME, Calendars.IS_PRIMARY, Calendars.OWNER_ACCOUNT, Calendars.ACCOUNT_TYPE},
        Calendars.CALENDAR_ACCESS_LEVEL + ">=" + Calendars.CAL_ACCESS_CONTRIBUTOR + " AND " + Calendars.VISIBLE + "=1",
        null,
        Calendars.ACCOUNT_NAME + "," + Calendars.IS_PRIMARY + " DESC")) {
      while (q != null && q.moveToNext())
        out.put(new JSONObject()
            .put("id", q.getLong(0))
            .put("name", q.getString(1))
            .put("account", q.getString(2))
            .put("primary", q.getInt(3) == 1)
            .put("owner", q.getString(4))
            .put("google", "com.google".equals(q.getString(5))));
    }
    return out;
  }

  // The chosen calendar if it still exists, else the primary calendar of `account`, else any
  // primary Google calendar, else the first writable one.
  public static long pick(Context c, long wanted, String account) throws Exception {
    JSONArray all = calendars(c);
    long pick = -1;
    for (int i = 0; i < all.length(); i++) if (all.getJSONObject(i).getLong("id") == wanted) return wanted;
    for (int i = 0; i < all.length() && pick < 0; i++) {
      JSONObject k = all.getJSONObject(i);
      if (k.optBoolean("primary") && k.optBoolean("google") && !account.isEmpty() && account.equals(k.optString("account"))) pick = k.getLong("id");
    }
    for (int i = 0; i < all.length() && pick < 0; i++) {
      JSONObject k = all.getJSONObject(i);
      if (k.optBoolean("primary") && k.optBoolean("google")) pick = k.getLong("id");
    }
    if (pick < 0 && all.length() > 0) pick = all.getJSONObject(0).getLong("id");
    if (pick < 0) throw new IOException("このスマホに書き込めるカレンダーがありません（Google アカウントのカレンダーを同期してください）");
    return pick;
  }

  static ContentValues values(JSONObject a) {
    ContentValues v = new ContentValues();
    v.put(Events.TITLE, a.optString("title"));
    v.put(Events.DESCRIPTION, a.optString("description"));
    v.put(Events.EVENT_LOCATION, a.optString("location"));
    v.put(Events.DTSTART, a.optLong("begin"));
    v.put(Events.DTEND, a.optLong("end"));
    boolean allDay = a.optBoolean("allDay");
    v.put(Events.ALL_DAY, allDay ? 1 : 0);
    v.put(Events.EVENT_TIMEZONE, allDay ? "UTC" : "Asia/Tokyo");
    return v;
  }

  public static boolean exists(Context c, long eventId) {
    try (Cursor q = c.getContentResolver().query(ContentUris.withAppendedId(Events.CONTENT_URI, eventId), new String[] {Events._ID, Events.DELETED}, null, null, null)) {
      return q != null && q.moveToFirst() && q.getInt(1) == 0;
    } catch (Exception e) {
      return false;
    }
  }

  // Adds the event, or updates it when eventId is still there. → {eventId, calendarId, calendarName, account}
  public static JSONObject put(Context c, JSONObject a) throws Exception {
    long eventId = a.optLong("eventId", -1);
    ContentValues v = values(a);
    if (eventId >= 0 && exists(c, eventId)) {
      c.getContentResolver().update(ContentUris.withAppendedId(Events.CONTENT_URI, eventId), v, null, null);
    } else {
      long cal = pick(c, a.optLong("calendarId", -1), a.optString("account"));
      v.put(Events.CALENDAR_ID, cal);
      v.put(Events.AVAILABILITY, Events.AVAILABILITY_BUSY);
      Uri u = c.getContentResolver().insert(Events.CONTENT_URI, v);
      if (u == null) throw new IOException("カレンダーに登録できませんでした");
      eventId = ContentUris.parseId(u);
    }
    JSONObject out = new JSONObject().put("eventId", eventId);
    try (Cursor q = c.getContentResolver().query(ContentUris.withAppendedId(Events.CONTENT_URI, eventId), new String[] {Events.CALENDAR_ID, Events.CALENDAR_DISPLAY_NAME, Events.ACCOUNT_NAME}, null, null, null)) {
      if (q != null && q.moveToFirst()) out.put("calendarId", q.getLong(0)).put("calendarName", q.getString(1)).put("account", q.getString(2));
    }
    return out;
  }

  public static void remove(Context c, long eventId) {
    if (eventId < 0) return;
    try {
      c.getContentResolver().delete(ContentUris.withAppendedId(Events.CONTENT_URI, eventId), null, null);
    } catch (Exception ignored) {
    }
  }

  // After Android has synced the event: its Google Calendar id (_SYNC_ID) and the calendar's id
  // (the calendar's _SYNC_ID, or the owner account for the primary calendar). Lets the Calendar
  // API add the pictures to the same event instead of making a second one. {} before the sync.
  public static JSONObject synced(Context c, long eventId) throws Exception {
    JSONObject out = new JSONObject();
    long cal = -1;
    try (Cursor q = c.getContentResolver().query(ContentUris.withAppendedId(Events.CONTENT_URI, eventId), new String[] {Events._SYNC_ID, Events.CALENDAR_ID}, null, null, null)) {
      if (q == null || !q.moveToFirst()) return out;
      if (q.getString(0) == null || q.getString(0).isEmpty()) return out;
      out.put("eventId", q.getString(0));
      cal = q.getLong(1);
    }
    try (Cursor q = c.getContentResolver().query(ContentUris.withAppendedId(Calendars.CONTENT_URI, cal), new String[] {Calendars._SYNC_ID, Calendars.OWNER_ACCOUNT, Calendars.ACCOUNT_TYPE}, null, null, null)) {
      if (q != null && q.moveToFirst() && "com.google".equals(q.getString(2))) out.put("calendarId", q.getString(0) != null && !q.getString(0).isEmpty() ? q.getString(0) : q.getString(1));
    }
    return out;
  }
}
