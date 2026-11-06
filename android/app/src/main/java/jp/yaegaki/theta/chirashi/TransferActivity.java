package jp.yaegaki.theta.chirashi;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ComponentName;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.widget.Toast;
import androidx.core.content.FileProvider;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.OutputStream;

// The series migration (Theta.Hatch.Series docs/MIGRATION.md §3), started by Theta Home Hatch
// (or from this app's settings):
//
//   Intent("app.thetahatch.action.EXPORT")  → asks the user, writes the zip (Transfer), and
//       when started for a result answers RESULT_OK with the zip as data (content://, read
//       permission granted, type application/zip) and extras "app"="chirashi", "format",
//       "records", "images". Started without a result, it offers to save the zip as a file.
//   Intent("app.thetahatch.action.IMPORT")  → data (or EXTRA_STREAM) is that zip; without one
//       the user picks it. Asks, merges, answers RESULT_OK with extras "records", "images",
//       or RESULT_CANCELED with extra "error".
//
// Nothing leaves the app without the user pressing the button on this screen.
public class TransferActivity extends Activity {
  public static final String EXPORT = "app.thetahatch.action.EXPORT";
  public static final String IMPORT = "app.thetahatch.action.IMPORT";
  static final int SAVE = 1, PICK = 2;
  final Handler main = new Handler(Looper.getMainLooper());
  File exported;

  @Override
  protected void onCreate(Bundle b) {
    super.onCreate(b);
    String action = getIntent().getAction();
    if (EXPORT.equals(action)) askExport();
    else if (IMPORT.equals(action)) {
      Uri u = incomingUri(getIntent());
      if (u != null) askImport(u);
      else pick();
    } else finish();
  }

  String caller() {
    ComponentName c = getCallingActivity();
    if (c == null) return null;
    try {
      PackageManager pm = getPackageManager();
      return String.valueOf(pm.getApplicationLabel(pm.getApplicationInfo(c.getPackageName(), 0)));
    } catch (Exception e) {
      return c.getPackageName();
    }
  }

  void cancel(String error) {
    Intent r = new Intent();
    if (error != null) r.putExtra("error", error);
    setResult(RESULT_CANCELED, r);
    if (error != null) Toast.makeText(this, error, Toast.LENGTH_LONG).show();
    finish();
  }

  // ---- export ------------------------------------------------------------------------------
  void askExport() {
    int[] n;
    try {
      n = Transfer.counts(this);
    } catch (Exception e) {
      cancel("データを読めませんでした：" + e.getMessage());
      return;
    }
    String who = caller();
    String msg = "チラシ " + n[0] + " 件と画像 " + n[1] + " 枚を、1 つのファイル（zip）に書き出します。"
        + (who != null ? "\n\n書き出したファイルは「" + who + "」に渡します（新しいアプリへの移行のため）。" : "")
        + "\n\nGemini APIキーは書き出しません。";
    new AlertDialog.Builder(this)
        .setTitle("データを書き出す")
        .setMessage(msg)
        .setPositiveButton(who != null ? "書き出して渡す" : "書き出す", (d, w) -> doExport())
        .setNegativeButton("キャンセル", (d, w) -> cancel(null))
        .setOnCancelListener(d -> cancel(null))
        .show();
  }

  void doExport() {
    Toast.makeText(this, "書き出しています…", Toast.LENGTH_SHORT).show();
    new Thread(() -> {
      try {
        File zip = Transfer.export(this);
        int[] n = Transfer.counts(this);
        main.post(() -> exported(zip, n));
      } catch (Exception e) {
        main.post(() -> cancel("書き出せませんでした：" + e.getMessage()));
      }
    }).start();
  }

  void exported(File zip, int[] n) {
    exported = zip;
    if (getCallingActivity() != null) {
      Uri u = FileProvider.getUriForFile(this, getPackageName() + ".files", zip);
      Intent r = new Intent()
          .setDataAndType(u, "application/zip")
          .putExtra(Intent.EXTRA_STREAM, u)
          .putExtra("app", "chirashi")
          .putExtra("format", Transfer.FORMAT)
          .putExtra("records", n[0])
          .putExtra("images", n[1])
          .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
      r.setClipData(ClipData.newRawUri("chirashi-export", u));
      setResult(RESULT_OK, r);
      Toast.makeText(this, "書き出しました", Toast.LENGTH_SHORT).show();
      finish();
      return;
    }
    // Opened from the app itself: keep the zip as a file the user chooses.
    Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("application/zip").putExtra(Intent.EXTRA_TITLE, zip.getName());
    startActivityForResult(i, SAVE);
  }

  // ---- import ------------------------------------------------------------------------------
  static Uri incomingUri(Intent i) {
    if (i.getData() != null) return i.getData();
    Uri s = i.getParcelableExtra(Intent.EXTRA_STREAM);
    if (s != null) return s;
    if (i.getClipData() != null && i.getClipData().getItemCount() > 0) return i.getClipData().getItemAt(0).getUri();
    return null;
  }

  void pick() {
    Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*")
        .putExtra(Intent.EXTRA_MIME_TYPES, new String[] {"application/zip", "application/x-zip-compressed", "application/octet-stream"});
    startActivityForResult(i, PICK);
  }

  void askImport(Uri u) {
    String who = caller();
    new AlertDialog.Builder(this)
        .setTitle("データを読み込む")
        .setMessage((who != null ? "「" + who + "」から渡された" : "選んだ") + "書き出しファイルのチラシと画像を、このアプリに読み込みます。すでにあるチラシは消えません（同じチラシは新しいほうにします）。")
        .setPositiveButton("読み込む", (d, w) -> doImport(u))
        .setNegativeButton("キャンセル", (d, w) -> cancel(null))
        .setOnCancelListener(d -> cancel(null))
        .show();
  }

  void doImport(Uri u) {
    Toast.makeText(this, "読み込んでいます…", Toast.LENGTH_SHORT).show();
    new Thread(() -> {
      try {
        int[] n = Transfer.importZip(this, u);
        main.post(() -> {
          setResult(RESULT_OK, new Intent().putExtra("app", "chirashi").putExtra("records", n[0]).putExtra("images", n[1]));
          Toast.makeText(this, "チラシ " + n[0] + " 件・画像 " + n[1] + " 枚を読み込みました", Toast.LENGTH_LONG).show();
          finish();
        });
      } catch (Exception e) {
        main.post(() -> cancel("読み込めませんでした：" + e.getMessage()));
      }
    }).start();
  }

  @Override
  protected void onActivityResult(int request, int result, Intent data) {
    super.onActivityResult(request, result, data);
    if (request == PICK) {
      if (result == RESULT_OK && data != null && data.getData() != null) askImport(data.getData());
      else cancel(null);
    } else if (request == SAVE) {
      if (result == RESULT_OK && data != null && data.getData() != null && exported != null) {
        try (InputStream in = new FileInputStream(exported); OutputStream out = getContentResolver().openOutputStream(data.getData())) {
          Transfer.copy(in, out);
          Toast.makeText(this, "書き出しファイルを保存しました", Toast.LENGTH_LONG).show();
          setResult(RESULT_OK);
        } catch (Exception e) {
          Toast.makeText(this, "保存できませんでした：" + e.getMessage(), Toast.LENGTH_LONG).show();
        }
      }
      finish();
    }
  }
}
