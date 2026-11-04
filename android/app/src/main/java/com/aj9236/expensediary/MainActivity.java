package com.aj9236.expensediary;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Telephony;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONArray;
import org.json.JSONObject;

/** Shows the Expense Diary page and gives it access to bank SMS on this phone. */
public class MainActivity extends Activity {
    static final String HOST = "aj9236.github.io";
    static final String START_URL = "https://aj9236.github.io/Expense-Diary/?app=android";
    private static final int SMS_REQUEST = 41;

    private WebView web;
    private volatile boolean trustedPage = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.parseColor("#F5EFE3"));
        web = new WebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);

        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if (HOST.equals(u.getHost())) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) { }
                return true;
            }

            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                trustedPage = url != null && HOST.equals(Uri.parse(url).getHost());
            }
        });
        web.addJavascriptInterface(new Bridge(), "ExpenseAndroid");

        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        else web.loadUrl(START_URL);
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack(); else super.onBackPressed();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode != SMS_REQUEST) return;
        final boolean ok = hasSms();
        web.post(() -> web.evaluateJavascript(
                "window.__onSmsPermission && window.__onSmsPermission(" + ok + ")", null));
    }

    private boolean hasSms() {
        return checkSelfPermission(Manifest.permission.RECEIVE_SMS) == PackageManager.PERMISSION_GRANTED
                && checkSelfPermission(Manifest.permission.READ_SMS) == PackageManager.PERMISSION_GRANTED;
    }

    /** Methods the page can call. Each one refuses to work for any page other than the diary. */
    final class Bridge {
        @JavascriptInterface
        public String version() {
            try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; }
            catch (Exception e) { return ""; }
        }

        @JavascriptInterface
        public void saveConfig(String url, String token) {
            if (!trustedPage || url == null || token == null) return;
            if (!url.startsWith("https://script.google.com/")) return;
            SmsStore.saveConfig(MainActivity.this, url, token);
        }

        @JavascriptInterface
        public boolean hasSmsPermission() {
            return trustedPage && hasSms();
        }

        @JavascriptInterface
        public void requestSmsPermission() {
            if (!trustedPage) return;
            runOnUiThread(() -> requestPermissions(
                    new String[]{Manifest.permission.RECEIVE_SMS, Manifest.permission.READ_SMS}, SMS_REQUEST));
        }

        @JavascriptInterface
        public void openAppSettings() {
            if (!trustedPage) return;
            Intent i = new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.fromParts("package", getPackageName(), null));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
        }

        /** Bank-style messages from the inbox in the last {@code days} days, newest first, as [{text, at}]. */
        @JavascriptInterface
        public String readRecentSms(int days) {
            JSONArray out = new JSONArray();
            if (!trustedPage || !hasSms()) return out.toString();
            long since = System.currentTimeMillis() - Math.max(1, Math.min(days, 180)) * 86400000L;
            try (Cursor c = getContentResolver().query(Telephony.Sms.Inbox.CONTENT_URI,
                    new String[]{Telephony.Sms.BODY, Telephony.Sms.DATE},
                    Telephony.Sms.DATE + " > ?", new String[]{String.valueOf(since)},
                    Telephony.Sms.DATE + " DESC")) {
                if (c != null) {
                    while (c.moveToNext() && out.length() < 400) {
                        String body = c.getString(0);
                        if (!SmsStore.looksLikeBankMessage(body)) continue;
                        JSONObject o = new JSONObject();
                        o.put("text", body);
                        o.put("at", c.getLong(1));
                        out.put(o);
                    }
                }
            } catch (Exception ignored) { }
            return out.toString();
        }

        /** Messages that could not be sent earlier (for example without internet). */
        @JavascriptInterface
        public String takePending() {
            if (!trustedPage) return "[]";
            return SmsStore.takePending(MainActivity.this);
        }
    }
}
