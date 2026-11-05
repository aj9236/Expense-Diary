package com.aj9236.expensediary;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.net.URLEncoder;

/**
 * Shows the Expense Diary page. The app asks for no sensitive permissions, so Android
 * installs it normally; bank SMS reach the owner's Google service through MacroDroid.
 */
public class MainActivity extends Activity {
    static final String HOST = "aj9236.github.io";
    static final String START_URL = "https://aj9236.github.io/Expense-Diary/?app=android";

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

        String setupUrl = setupUrlFrom(getIntent());
        if (setupUrl != null) web.loadUrl(setupUrl);
        else if (savedInstanceState != null) web.restoreState(savedInstanceState);
        else web.loadUrl(START_URL);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String setupUrl = setupUrlFrom(intent);
        if (setupUrl != null) web.loadUrl(setupUrl);
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

    /** Handles expensediary://setup?cfg={"url":..,"token":..} from the service's connect page. */
    private String setupUrlFrom(Intent intent) {
        if (intent == null) return null;
        if (Intent.ACTION_SEND.equals(intent.getAction())) {
            // A bank SMS shared from the Messages app
            CharSequence shared = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
            if (shared == null || shared.length() == 0) return null;
            String text = shared.toString();
            if (text.length() > 2000) text = text.substring(0, 2000);
            try {
                return START_URL + "&shared=1#share=" + URLEncoder.encode(text, "UTF-8").replace("+", "%20");
            } catch (Exception e) {
                return null;
            }
        }
        if (intent.getData() == null) return null;
        Uri d = intent.getData();
        if (!"expensediary".equals(d.getScheme()) || !"setup".equals(d.getHost())) return null;
        try {
            JSONObject o = new JSONObject(d.getQueryParameter("cfg"));
            String url = o.getString("url"), token = o.getString("token");
            if (!url.startsWith("https://script.google.com/") || token.isEmpty()) return null;
            JSONObject clean = new JSONObject();
            clean.put("url", url);
            clean.put("token", token);
            return START_URL + "&connected=1#setup=" + URLEncoder.encode(clean.toString(), "UTF-8").replace("+", "%20");
        } catch (Exception e) {
            return null;
        }
    }

    /** Methods the page can call. Each one refuses to work for any page other than the diary. */
    final class Bridge {
        @JavascriptInterface
        public String version() {
            try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; }
            catch (Exception e) { return ""; }
        }

        @JavascriptInterface
        public boolean copyText(String text) {
            if (!trustedPage || text == null) return false;
            ClipboardManager cm = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
            if (cm == null) return false;
            cm.setPrimaryClip(ClipData.newPlainText("Expense Diary", text));
            return true;
        }

        @JavascriptInterface
        public void openUrl(String url) {
            if (!trustedPage || url == null || !url.startsWith("https://")) return;
            runOnUiThread(() -> {
                try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); } catch (Exception ignored) { }
            });
        }
    }
}
