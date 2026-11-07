package app.thetahatch.chirashi;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import com.google.android.gms.tasks.Tasks;
import com.google.mlkit.vision.barcode.BarcodeScanner;
import com.google.mlkit.vision.barcode.BarcodeScannerOptions;
import com.google.mlkit.vision.barcode.BarcodeScanning;
import com.google.mlkit.vision.barcode.common.Barcode;
import com.google.mlkit.vision.common.InputImage;
import java.io.File;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;

// QR codes on a flyer (Zoom / Teams / Webex links, sign-up forms) read on the phone with ML Kit.
// Small codes on an A4 sheet are easier to find in pieces, so the whole page is tried first and
// then its overlapping quarters.
public final class Qr {
  private Qr() {}

  public static JSONArray read(Context c, File f) throws Exception {
    BitmapFactory.Options o = new BitmapFactory.Options();
    o.inJustDecodeBounds = true;
    BitmapFactory.decodeFile(f.getPath(), o);
    int sample = 1;
    while (Math.max(o.outWidth, o.outHeight) / sample > 4000) sample *= 2;
    o = new BitmapFactory.Options();
    o.inSampleSize = sample;
    Bitmap full = BitmapFactory.decodeFile(f.getPath(), o);
    if (full == null) throw new Exception("画像を開けませんでした");
    BarcodeScanner scanner =
        BarcodeScanning.getClient(new BarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE, Barcode.FORMAT_DATA_MATRIX, Barcode.FORMAT_AZTEC).build());
    Set<String> seen = new LinkedHashSet<>();
    JSONArray out = new JSONArray();
    try {
      collect(scanner, full, seen, out);
      int w = full.getWidth(), h = full.getHeight();
      int cw = (int) (w * 0.6), ch = (int) (h * 0.6);
      int[][] at = {{0, 0}, {w - cw, 0}, {0, h - ch}, {w - cw, h - ch}};
      for (int[] p : at) {
        Bitmap part = Bitmap.createBitmap(full, p[0], p[1], cw, ch);
        collect(scanner, part, seen, out);
        part.recycle();
      }
    } finally {
      scanner.close();
      full.recycle();
    }
    return out;
  }

  static void collect(BarcodeScanner scanner, Bitmap b, Set<String> seen, JSONArray out) throws Exception {
    List<Barcode> found = Tasks.await(scanner.process(InputImage.fromBitmap(b, 0)), 30, TimeUnit.SECONDS);
    for (Barcode code : found) {
      String raw = code.getRawValue();
      if (raw == null || raw.isEmpty() || !seen.add(raw)) continue;
      String url = code.getUrl() != null ? code.getUrl().getUrl() : "";
      out.put(new JSONObject().put("raw", raw).put("url", url == null ? "" : url));
    }
  }
}
