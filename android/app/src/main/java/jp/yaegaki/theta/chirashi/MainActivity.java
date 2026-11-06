package jp.yaegaki.theta.chirashi;

import android.Manifest;
import android.accounts.Account;
import android.accounts.AccountManager;
import android.content.ActivityNotFoundException;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.CalendarContract;
import android.provider.ContactsContract;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.MimeTypeMap;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.activity.ComponentActivity;
import androidx.activity.OnBackPressedCallback;
import androidx.core.content.FileProvider;
import androidx.webkit.WebViewAssetLoader;
import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.common.api.Scope;
import com.google.mlkit.vision.documentscanner.GmsDocumentScanner;
import com.google.mlkit.vision.documentscanner.GmsDocumentScannerOptions;
import com.google.mlkit.vision.documentscanner.GmsDocumentScanning;
import com.google.mlkit.vision.documentscanner.GmsDocumentScanningResult;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONArray;
import org.json.JSONObject;

// The app: the screen (assets/www) runs in a WebView served from
// https://appassets.androidplatform.net; this class supplies what the phone does natively —
// Google's document scanner, QR reading (ML Kit), Google account access through Play services,
// the calendar / contacts apps, files and sharing, the back button.
// JavaScript calls AndroidNative.call(method, json, id); answers come back through
// window.AndroidReply(id, json).
public class MainActivity extends ComponentActivity {
  static final String HOST = "appassets.androidplatform.net";
  static final String START = "https://" + HOST + "/www/index.html";
  static final int SCAN = 1, AUTH = 2, ACCOUNT = 3, SAVE = 4, FILES = 5, PERMS = 6;
  // Calendar: create / change the events this app makes. Calendar list: choose which calendar.
  // Drive (per file): upload the flyer pictures and attach them to the event.
  static final String[] SCOPES = {
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
    "https://www.googleapis.com/auth/drive.file"
  };

  WebView web;
  final Handler main = new Handler(Looper.getMainLooper());
  final ExecutorService work = Executors.newSingleThreadExecutor();
  String scanId, authId, accountId, saveId;
  JSONObject authArgs;
  byte[] saveBytes;
  ValueCallback<Uri[]> fileCallback;
  PermissionRequest pendingPermission;
  Intent pendingShare;
  boolean ready;

  @Override
  protected void onCreate(Bundle b) {
    super.onCreate(b);
    WebView.setWebContentsDebuggingEnabled((getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0);
    web = new WebView(this);
    web.setBackgroundColor(Color.rgb(251, 247, 242));
    WebSettings s = web.getSettings();
    s.setJavaScriptEnabled(true);
    s.setDomStorageEnabled(true);
    s.setAllowFileAccess(false);
    s.setAllowContentAccess(false);
    s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
    s.setSupportZoom(false);
    web.addJavascriptInterface(new Bridge(), "AndroidNative");
    final WebViewAssetLoader assets = new WebViewAssetLoader.Builder().setDomain(HOST).addPathHandler("/www/", new Assets()).build();
    web.setWebViewClient(new WebViewClient() {
      @Override
      public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
        Uri u = r.getUrl();
        if (!HOST.equals(u.getHost())) return null; // Google APIs, Gemini: the network as usual
        String p = u.getPath() == null ? "" : u.getPath();
        try {
          if (p.startsWith("/www/media/")) return fileResponse(new File(mediaDir(), safe(p.substring(11))));
          if (p.startsWith("/www/incoming/")) return fileResponse(new File(incomingDir(), safe(p.substring(14))));
        } catch (Exception e) {
          return notFound();
        }
        return assets.shouldInterceptRequest(u);
      }

      @Override
      public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
        String u = r.getUrl().toString();
        if (u.startsWith("https://" + HOST + "/")) return false;
        openUrl(u);
        return true;
      }

      @Override
      public void onPageFinished(WebView v, String url) {
        ready = true;
        if (pendingShare != null) {
          Intent i = pendingShare;
          pendingShare = null;
          receiveShare(i);
        }
      }
    });
    web.setWebChromeClient(new WebChromeClient() {
      @Override
      public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams params) {
        if (fileCallback != null) fileCallback.onReceiveValue(null);
        fileCallback = cb;
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("image/*");
        i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
        try {
          startActivityForResult(i, FILES);
        } catch (ActivityNotFoundException e) {
          fileCallback = null;
          return false;
        }
        return true;
      }

      @Override
      public void onPermissionRequest(PermissionRequest req) {
        if (!HOST.equals(req.getOrigin().getHost())) {
          req.deny();
          return;
        }
        if (granted(Manifest.permission.CAMERA)) {
          req.grant(req.getResources());
          return;
        }
        pendingPermission = req;
        requestPermissions(new String[] {Manifest.permission.CAMERA}, PERMS);
      }
    });
    getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
      @Override
      public void handleOnBackPressed() {
        if (!ready) {
          finish();
          return;
        }
        web.evaluateJavascript("window.handleBack ? String(window.handleBack()) : 'false'", r -> {
          if (r == null || r.contains("false")) moveTaskToBack(true);
        });
      }
    });
    setContentView(web);
    web.loadUrl(START);
    if (isShare(getIntent())) pendingShare = getIntent();
  }

  @Override
  protected void onNewIntent(Intent i) {
    super.onNewIntent(i);
    if (isShare(i)) {
      if (ready) receiveShare(i);
      else pendingShare = i;
    }
  }

  boolean granted(String p) {
    return checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED;
  }

  @Override
  public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
    super.onRequestPermissionsResult(code, perms, results);
    if (code != PERMS || pendingPermission == null) return;
    PermissionRequest req = pendingPermission;
    pendingPermission = null;
    if (granted(Manifest.permission.CAMERA)) req.grant(req.getResources());
    else req.deny();
  }

  // ---- answers to the page ---------------------------------------------------------------
  void js(String code) {
    main.post(() -> {
      if (web != null && ready) web.evaluateJavascript(code, null);
    });
  }

  void reply(String id, JSONObject data) {
    if (id == null) return;
    js("window.AndroidReply && AndroidReply(" + JSONObject.quote(id) + "," + data.toString() + ")");
  }

  void fail(String id, String message) {
    try {
      reply(id, new JSONObject().put("error", message == null ? "エラー" : message));
    } catch (Exception ignored) {
    }
  }

  // ---- files ---------------------------------------------------------------------------
  File mediaDir() {
    File d = new File(getFilesDir(), "media");
    d.mkdirs();
    return d;
  }

  File incomingDir() {
    File d = new File(getCacheDir(), "incoming");
    d.mkdirs();
    return d;
  }

  File dataFile() {
    return new File(getFilesDir(), "chirashi.json");
  }

  static String safe(String name) {
    if (!name.matches("[A-Za-z0-9_.-]{1,200}") || name.contains("..")) throw new IllegalArgumentException("不正なファイル名");
    return name;
  }

  static String typeOf(String name) {
    String ext = name.substring(name.lastIndexOf('.') + 1).toLowerCase();
    switch (ext) {
      case "js":
        return "text/javascript";
      case "json":
        return "application/json";
      case "svg":
        return "image/svg+xml";
      default:
        String t = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);
        return t == null ? "application/octet-stream" : t;
    }
  }

  static WebResourceResponse notFound() {
    return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", null, new ByteArrayInputStream(new byte[0]));
  }

  WebResourceResponse fileResponse(File f) {
    try {
      if (!f.exists()) return notFound();
      return new WebResourceResponse(typeOf(f.getName()), null, new FileInputStream(f));
    } catch (Exception e) {
      return notFound();
    }
  }

  class Assets implements WebViewAssetLoader.PathHandler {
    @Override
    public WebResourceResponse handle(String path) {
      try {
        if (path.isEmpty() || path.endsWith("/")) path += "index.html";
        if (path.contains("..")) return null;
        InputStream in = getAssets().open("www/" + path);
        return new WebResourceResponse(typeOf(path), path.matches(".*\\.(html|js|css|json|svg)$") ? "utf-8" : null, in);
      } catch (Exception e) {
        return notFound();
      }
    }
  }

  static void copy(InputStream in, OutputStream out) throws Exception {
    byte[] buf = new byte[65536];
    for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
  }

  // A picked or scanned picture, copied where the page can fetch it: /incoming/<name>.
  JSONObject incoming(Uri u) throws Exception {
    String name = UUID.randomUUID().toString().replace("-", "").substring(0, 16) + ".jpg";
    try (InputStream in = getContentResolver().openInputStream(u); OutputStream out = new FileOutputStream(new File(incomingDir(), name))) {
      copy(in, out);
    }
    return new JSONObject().put("path", "incoming/" + name).put("name", name);
  }

  static boolean isShare(Intent i) {
    return i != null && (Intent.ACTION_SEND.equals(i.getAction()) || Intent.ACTION_SEND_MULTIPLE.equals(i.getAction()));
  }

  // Photos of flyers shared from the gallery, LINE, Gmail…: read like a scan.
  void receiveShare(Intent i) {
    try {
      List<Uri> uris = new ArrayList<>();
      if (Intent.ACTION_SEND.equals(i.getAction())) {
        Uri u = i.getParcelableExtra(Intent.EXTRA_STREAM);
        if (u != null) uris.add(u);
      } else {
        ArrayList<Uri> list = i.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
        if (list != null) uris.addAll(list);
      }
      JSONArray files = new JSONArray();
      for (Uri u : uris) files.put(incoming(u));
      if (files.length() > 0) js("window.AndroidShared && AndroidShared(" + files + ")");
    } catch (Exception e) {
      js("window.toast && toast(" + JSONObject.quote("共有された画像を読み込めませんでした：" + e.getMessage()) + ")");
    }
  }

  void openUrl(String u) {
    if (!u.matches("^(https?|tel|mailto|geo):.*")) return;
    try {
      startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(u)));
    } catch (Exception ignored) {
    }
  }

  Uri shareUri(String name) {
    File f = new File(mediaDir(), safe(name));
    return FileProvider.getUriForFile(this, getPackageName() + ".files", f);
  }

  // ---- Google accounts (Play services) ----------------------------------------------------
  void authorize(String id, JSONObject a, boolean interactive) {
    try {
      List<Scope> scopes = new ArrayList<>();
      for (String sc : SCOPES) scopes.add(new Scope(sc));
      AuthorizationRequest.Builder rb = AuthorizationRequest.builder().setRequestedScopes(scopes);
      String email = a.optString("email");
      if (!email.isEmpty()) rb.setAccount(new Account(email, "com.google"));
      Identity.getAuthorizationClient(this).authorize(rb.build())
          .addOnSuccessListener(r -> {
            if (r.hasResolution()) {
              if (!interactive) {
                try {
                  reply(id, new JSONObject().put("needLogin", true));
                } catch (Exception ignored) {
                }
                return;
              }
              try {
                authId = id;
                authArgs = a;
                startIntentSenderForResult(r.getPendingIntent().getIntentSender(), AUTH, null, 0, 0, 0, null);
              } catch (Exception e) {
                authId = null;
                fail(id, e.getMessage());
              }
            } else token(id, r, email);
          })
          .addOnFailureListener(e -> fail(id, "Googleに接続できませんでした：" + e.getMessage() + "（Google CloudにAndroid用のOAuthクライアント〔パッケージ名とSHA-1〕を登録してあるか確認してください）"));
    } catch (Exception e) {
      fail(id, e.getMessage());
    }
  }

  void token(String id, AuthorizationResult r, String email) {
    try {
      if (r.getAccessToken() == null) {
        fail(id, "Googleの許可を取得できませんでした");
        return;
      }
      reply(id, new JSONObject().put("token", r.getAccessToken()).put("email", email));
    } catch (Exception e) {
      fail(id, e.getMessage());
    }
  }

  // ---- results ----------------------------------------------------------------------------
  @Override
  protected void onActivityResult(int request, int result, Intent data) {
    super.onActivityResult(request, result, data);
    try {
      if (request == FILES) {
        ValueCallback<Uri[]> cb = fileCallback;
        fileCallback = null;
        if (cb == null) return;
        if (result != RESULT_OK || data == null) {
          cb.onReceiveValue(null);
          return;
        }
        List<Uri> out = new ArrayList<>();
        if (data.getClipData() != null) for (int i = 0; i < data.getClipData().getItemCount(); i++) out.add(data.getClipData().getItemAt(i).getUri());
        else if (data.getData() != null) out.add(data.getData());
        cb.onReceiveValue(out.toArray(new Uri[0]));
      } else if (request == SCAN) {
        String id = scanId;
        scanId = null;
        JSONArray files = new JSONArray();
        if (result == RESULT_OK) {
          GmsDocumentScanningResult scan = GmsDocumentScanningResult.fromActivityResultIntent(data);
          if (scan != null && scan.getPages() != null)
            for (GmsDocumentScanningResult.Page page : scan.getPages()) files.put(incoming(page.getImageUri()));
        }
        reply(id, new JSONObject().put("files", files));
      } else if (request == ACCOUNT) {
        String id = accountId;
        accountId = null;
        String email = result == RESULT_OK && data != null ? data.getStringExtra(AccountManager.KEY_ACCOUNT_NAME) : null;
        if (email == null) {
          fail(id, "Googleアカウントを選びませんでした");
          return;
        }
        JSONObject a = authArgs != null ? authArgs : new JSONObject();
        a.put("email", email);
        authorize(id, a, true);
      } else if (request == AUTH) {
        String id = authId;
        authId = null;
        if (result != RESULT_OK) {
          fail(id, "Googleの許可を中止しました（Google Cloudの設定が足りないときも、このように返ってきます）");
          return;
        }
        AuthorizationResult r = Identity.getAuthorizationClient(this).getAuthorizationResultFromIntent(data);
        token(id, r, authArgs != null ? authArgs.optString("email") : "");
      } else if (request == SAVE) {
        String id = saveId;
        byte[] bytes = saveBytes;
        saveId = null;
        saveBytes = null;
        if (result != RESULT_OK || data == null || data.getData() == null) {
          reply(id, new JSONObject().put("saved", false));
          return;
        }
        try (OutputStream out = getContentResolver().openOutputStream(data.getData())) {
          out.write(bytes);
        }
        reply(id, new JSONObject().put("saved", true));
      }
    } catch (Exception e) {
      js("window.toast && toast(" + JSONObject.quote(String.valueOf(e.getMessage())) + ")");
    }
  }

  // This build's signing certificate: what the Android OAuth client in Google Cloud must name.
  String signingSha1() {
    try {
      android.content.pm.Signature[] sig = Build.VERSION.SDK_INT >= 28
          ? getPackageManager().getPackageInfo(getPackageName(), PackageManager.GET_SIGNING_CERTIFICATES).signingInfo.getApkContentsSigners()
          : getPackageManager().getPackageInfo(getPackageName(), PackageManager.GET_SIGNATURES).signatures;
      byte[] d = java.security.MessageDigest.getInstance("SHA-1").digest(sig[0].toByteArray());
      StringBuilder b = new StringBuilder();
      for (byte x : d) b.append(b.length() == 0 ? "" : ":").append(String.format("%02X", x));
      return b.toString();
    } catch (Exception e) {
      return "";
    }
  }

  // ---- the bridge -------------------------------------------------------------------------
  class Bridge {
    @JavascriptInterface
    public String info() {
      try {
        return new JSONObject()
            .put("version", getPackageManager().getPackageInfo(getPackageName(), 0).versionName)
            .put("package", getPackageName())
            .put("sha1", signingSha1())
            .toString();
      } catch (Exception e) {
        return "{}";
      }
    }

    @JavascriptInterface
    public String secretGet() {
      try {
        return SecretBox.get(MainActivity.this);
      } catch (Exception e) {
        return "";
      }
    }

    @JavascriptInterface
    public void secretSet(String v) {
      try {
        SecretBox.save(MainActivity.this, v == null ? "" : v);
      } catch (Exception ignored) {
      }
    }

    // All records: one JSON file in the app's storage (written whole, through a temporary file).
    @JavascriptInterface
    public String loadData() {
      File f = dataFile();
      if (!f.exists()) return "";
      try (InputStream in = new FileInputStream(f)) {
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        copy(in, out);
        return out.toString("UTF-8");
      } catch (Exception e) {
        return "";
      }
    }

    @JavascriptInterface
    public String saveData(String json) {
      try {
        File tmp = new File(getFilesDir(), "chirashi.json.tmp");
        try (OutputStream out = new FileOutputStream(tmp)) {
          out.write(json.getBytes("UTF-8"));
        }
        File f = dataFile();
        File bak = new File(getFilesDir(), "chirashi.json.bak");
        if (f.exists()) {
          bak.delete();
          f.renameTo(bak);
        }
        if (!tmp.renameTo(f)) throw new Exception("保存できませんでした");
        return "";
      } catch (Exception e) {
        return String.valueOf(e.getMessage());
      }
    }

    // A scanned picture moved from incoming/ into the app's own files: media/<name>.
    @JavascriptInterface
    public String keep(String incomingName) {
      try {
        File src = new File(incomingDir(), safe(incomingName));
        File dst = new File(mediaDir(), safe(incomingName));
        if (!src.renameTo(dst)) {
          try (InputStream in = new FileInputStream(src); OutputStream out = new FileOutputStream(dst)) {
            copy(in, out);
          }
          src.delete();
        }
        return "";
      } catch (Exception e) {
        return String.valueOf(e.getMessage());
      }
    }

    @JavascriptInterface
    public String writeMedia(String name, String base64) {
      try {
        File f = new File(mediaDir(), safe(name));
        try (OutputStream out = new FileOutputStream(f)) {
          out.write(Base64.decode(base64, Base64.DEFAULT));
        }
        return "";
      } catch (Exception e) {
        return String.valueOf(e.getMessage());
      }
    }

    @JavascriptInterface
    public void deleteMedia(String name) {
      try {
        new File(mediaDir(), safe(name)).delete();
      } catch (Exception ignored) {
      }
    }

    @JavascriptInterface
    public void call(String method, String json, String id) {
      main.post(() -> {
        try {
          JSONObject a = json == null || json.isEmpty() ? new JSONObject() : new JSONObject(json);
          switch (method) {
            case "scan":
              scan(id, a);
              break;
            case "qr": {
              String path = a.optString("path");
              File f = path.startsWith("incoming/") ? new File(incomingDir(), safe(path.substring(9))) : new File(mediaDir(), safe(path.replaceFirst("^media/", "")));
              work.execute(() -> {
                try {
                  reply(id, new JSONObject().put("codes", Qr.read(MainActivity.this, f)));
                } catch (Throwable e) {
                  fail(id, "QRを読めませんでした：" + e.getMessage());
                }
              });
              break;
            }
            case "token":
              if (a.optBoolean("chooser") || (a.optString("email").isEmpty() && a.optBoolean("interactive"))) {
                accountId = id;
                authArgs = a;
                String hint = a.optString("email");
                Intent pick = AccountManager.newChooseAccountIntent(hint.isEmpty() ? null : new Account(hint, "com.google"), null, new String[] {"com.google"}, null, null, null, null);
                startActivityForResult(pick, ACCOUNT);
              } else if (a.optString("email").isEmpty()) reply(id, new JSONObject().put("needLogin", true));
              else authorize(id, a, a.optBoolean("interactive"));
              break;
            case "calendarIntent": {
              // No Google Cloud setup needed: the phone's calendar app opens with the event filled in.
              Intent i = new Intent(Intent.ACTION_INSERT).setData(CalendarContract.Events.CONTENT_URI)
                  .putExtra(CalendarContract.Events.TITLE, a.optString("title"))
                  .putExtra(CalendarContract.Events.EVENT_LOCATION, a.optString("location"))
                  .putExtra(CalendarContract.Events.DESCRIPTION, a.optString("description"))
                  .putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, a.optLong("begin"))
                  .putExtra(CalendarContract.EXTRA_EVENT_END_TIME, a.optLong("end"))
                  .putExtra(CalendarContract.EXTRA_EVENT_ALL_DAY, a.optBoolean("allDay"));
              startActivity(i);
              reply(id, new JSONObject());
              break;
            }
            case "contactIntent": {
              Intent i = new Intent(ContactsContract.Intents.Insert.ACTION).setType(ContactsContract.RawContacts.CONTENT_TYPE);
              i.putExtra(ContactsContract.Intents.Insert.NAME, a.optString("name"));
              i.putExtra(ContactsContract.Intents.Insert.COMPANY, a.optString("company"));
              i.putExtra(ContactsContract.Intents.Insert.JOB_TITLE, (a.optString("department") + " " + a.optString("title")).trim());
              i.putExtra(ContactsContract.Intents.Insert.NOTES, a.optString("note"));
              ArrayList<ContentValues> rows = new ArrayList<>();
              phone(rows, a.optString("mobile"), ContactsContract.CommonDataKinds.Phone.TYPE_MOBILE);
              phone(rows, a.optString("phone"), ContactsContract.CommonDataKinds.Phone.TYPE_WORK);
              phone(rows, a.optString("fax"), ContactsContract.CommonDataKinds.Phone.TYPE_FAX_WORK);
              if (!a.optString("email").isEmpty()) {
                ContentValues v = new ContentValues();
                v.put(ContactsContract.Data.MIMETYPE, ContactsContract.CommonDataKinds.Email.CONTENT_ITEM_TYPE);
                v.put(ContactsContract.CommonDataKinds.Email.ADDRESS, a.optString("email"));
                v.put(ContactsContract.CommonDataKinds.Email.TYPE, ContactsContract.CommonDataKinds.Email.TYPE_WORK);
                rows.add(v);
              }
              if (!a.optString("address").isEmpty()) {
                ContentValues v = new ContentValues();
                v.put(ContactsContract.Data.MIMETYPE, ContactsContract.CommonDataKinds.StructuredPostal.CONTENT_ITEM_TYPE);
                v.put(ContactsContract.CommonDataKinds.StructuredPostal.FORMATTED_ADDRESS, a.optString("address"));
                v.put(ContactsContract.CommonDataKinds.StructuredPostal.TYPE, ContactsContract.CommonDataKinds.StructuredPostal.TYPE_WORK);
                rows.add(v);
              }
              i.putParcelableArrayListExtra(ContactsContract.Intents.Insert.DATA, rows);
              startActivity(i);
              reply(id, new JSONObject());
              break;
            }
            case "saveFile": {
              saveId = id;
              saveBytes = a.optString("text").getBytes("UTF-8");
              Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(a.optString("type", "text/plain")).putExtra(Intent.EXTRA_TITLE, a.optString("name"));
              startActivityForResult(i, SAVE);
              break;
            }
            case "openUrl":
              openUrl(a.optString("url"));
              reply(id, new JSONObject());
              break;
            case "share": {
              JSONArray names = a.optJSONArray("names");
              ArrayList<Uri> uris = new ArrayList<>();
              if (names != null) for (int k = 0; k < names.length(); k++) uris.add(shareUri(names.getString(k)));
              Intent i;
              if (uris.size() == 1) i = new Intent(Intent.ACTION_SEND).setType("image/jpeg").putExtra(Intent.EXTRA_STREAM, uris.get(0));
              else i = new Intent(Intent.ACTION_SEND_MULTIPLE).setType("image/jpeg").putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris);
              if (!a.optString("text").isEmpty()) i.putExtra(Intent.EXTRA_TEXT, a.optString("text"));
              i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
              startActivity(Intent.createChooser(i, "共有"));
              reply(id, new JSONObject());
              break;
            }
            case "copyText": {
              android.content.ClipboardManager cm = (android.content.ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
              cm.setPrimaryClip(android.content.ClipData.newPlainText("text", a.optString("text")));
              reply(id, new JSONObject());
              break;
            }
            default:
              fail(id, "未対応の操作：" + method);
          }
        } catch (Exception e) {
          fail(id, e.getMessage());
        }
      });
    }
  }

  static void phone(ArrayList<ContentValues> rows, String number, int type) {
    if (number == null || number.isEmpty()) return;
    ContentValues v = new ContentValues();
    v.put(ContactsContract.Data.MIMETYPE, ContactsContract.CommonDataKinds.Phone.CONTENT_ITEM_TYPE);
    v.put(ContactsContract.CommonDataKinds.Phone.NUMBER, number);
    v.put(ContactsContract.CommonDataKinds.Phone.TYPE, type);
    rows.add(v);
  }

  // Google's document scanner (edges found and straightened; several pages; photos from the
  // gallery too). On a phone without it the page offers the gallery instead.
  void scan(String id, JSONObject a) {
    GmsDocumentScannerOptions options = new GmsDocumentScannerOptions.Builder()
        .setGalleryImportAllowed(true)
        .setPageLimit(Math.max(1, Math.min(30, a.optInt("pages", 20))))
        .setResultFormats(GmsDocumentScannerOptions.RESULT_FORMAT_JPEG)
        .setScannerMode(GmsDocumentScannerOptions.SCANNER_MODE_FULL)
        .build();
    GmsDocumentScanner scanner = GmsDocumentScanning.getClient(options);
    scanner.getStartScanIntent(this)
        .addOnSuccessListener(sender -> {
          try {
            scanId = id;
            startIntentSenderForResult(sender, SCAN, null, 0, 0, 0, null);
          } catch (Exception e) {
            scanId = null;
            unavailable(id);
          }
        })
        .addOnFailureListener(e -> unavailable(id));
  }

  void unavailable(String id) {
    try {
      reply(id, new JSONObject().put("unavailable", true));
    } catch (Exception ignored) {
    }
  }
}
