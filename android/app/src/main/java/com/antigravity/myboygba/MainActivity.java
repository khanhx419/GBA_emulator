package com.antigravity.myboygba;

import android.os.Bundle;
import android.os.Build;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.util.Base64;
import android.widget.Toast;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        hideSystemUI();
        setupDownloadBridge();
    }

    private void setupDownloadBridge() {
        if (getBridge() != null && getBridge().getWebView() != null) {
            WebView webView = getBridge().getWebView();
            webView.addJavascriptInterface(new Object() {
                @JavascriptInterface
                public boolean saveBase64File(String fileName, String base64Data) {
                    try {
                        byte[] data = Base64.decode(base64Data, Base64.DEFAULT);
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                            android.content.ContentValues values = new android.content.ContentValues();
                            values.put(android.provider.MediaStore.Downloads.DISPLAY_NAME, fileName);
                            values.put(android.provider.MediaStore.Downloads.MIME_TYPE, "application/octet-stream");
                            values.put(android.provider.MediaStore.Downloads.RELATIVE_PATH, android.os.Environment.DIRECTORY_DOWNLOADS);
                            android.net.Uri uri = getContentResolver().insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                            if (uri != null) {
                                java.io.OutputStream os = getContentResolver().openOutputStream(uri);
                                if (os != null) {
                                    os.write(data);
                                    os.close();
                                    runOnUiThread(() -> Toast.makeText(MainActivity.this, "Đã lưu " + fileName + " vào thư mục Download!", Toast.LENGTH_LONG).show());
                                    return true;
                                }
                            }
                        } else {
                            java.io.File dir = android.os.Environment.getExternalStoragePublicDirectory(android.os.Environment.DIRECTORY_DOWNLOADS);
                            if (!dir.exists()) dir.mkdirs();
                            java.io.File file = new java.io.File(dir, fileName);
                            java.io.FileOutputStream fos = new java.io.FileOutputStream(file);
                            fos.write(data);
                            fos.close();
                            android.media.MediaScannerConnection.scanFile(MainActivity.this, new String[]{file.getAbsolutePath()}, null, null);
                            runOnUiThread(() -> Toast.makeText(MainActivity.this, "Đã lưu " + fileName + " vào thư mục Download!", Toast.LENGTH_LONG).show());
                            return true;
                        }
                    } catch (Exception e) {
                        e.printStackTrace();
                    }
                    return false;
                }
            }, "AndroidBridge");
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            hideSystemUI();
        }
    }

    private void hideSystemUI() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) {
                controller.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            View decorView = getWindow().getDecorView();
            decorView.setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_FULLSCREEN
            );
        }
    }
}
