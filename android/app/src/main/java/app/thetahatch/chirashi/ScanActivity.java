package app.thetahatch.chirashi;

import android.net.Uri;

// "Take a flyer" (Theta.Hatch.Series spec/THETA_HATCH_SPEC.md, SCAN): opened by another series app
// (Theta Home Hatch's schedule tab) with Intent("app.thetahatch.action.SCAN"), extras
// source = the caller's catalog id, mode = camera (default) | pick. The same screen as the app, in
// a window of its own in the caller's task: it opens the scanner (or the picture picker) at once,
// reads the flyer, lets the user check it and puts it in the phone's calendar, then finishes —
// RESULT_OK when registered, RESULT_CANCELED when the user stopped.
public class ScanActivity extends MainActivity {
  boolean registered;

  @Override
  String startUrl() {
    String mode = "pick".equals(getIntent().getStringExtra("mode")) ? "pick" : "camera";
    String source = getIntent().getStringExtra("source");
    return START + "?scan=" + mode + "&source=" + Uri.encode(source == null ? "" : source.replaceAll("[^A-Za-z0-9_.-]", ""));
  }

  @Override
  void done(boolean ok) {
    registered |= ok;
    setResult(registered ? RESULT_OK : RESULT_CANCELED);
    finish();
  }

  @Override
  void onRootBack() {
    done(false);
  }
}
