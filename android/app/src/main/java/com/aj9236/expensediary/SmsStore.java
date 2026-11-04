package com.aj9236.expensediary;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.regex.Pattern;

/** Settings, the bank-message check, and sending to the owner's Google service. */
final class SmsStore {
    private static final String PREFS = "expense_diary";
    private static final String KEY_URL = "service_url";
    private static final String KEY_TOKEN = "service_token";
    private static final String KEY_PENDING = "pending_sms";
    private static final int MAX_PENDING = 200;

    /** An amount written as Rs, INR or the rupee sign followed by digits. */
    private static final Pattern MONEY = Pattern.compile("(?i)(rs\\.?|inr|₹)\\s*:?\\s*[0-9]");

    private SmsStore() { }

    static boolean looksLikeBankMessage(String body) {
        return body != null && MONEY.matcher(body).find();
    }

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static void saveConfig(Context c, String url, String token) {
        prefs(c).edit().putString(KEY_URL, url).putString(KEY_TOKEN, token).apply();
    }

    static boolean isConfigured(Context c) {
        SharedPreferences p = prefs(c);
        return !p.getString(KEY_URL, "").isEmpty() && !p.getString(KEY_TOKEN, "").isEmpty();
    }

    /** Sends one message to the service. Returns true when the service accepted the request. */
    static boolean send(Context c, String body) {
        SharedPreferences p = prefs(c);
        String url = p.getString(KEY_URL, "");
        String token = p.getString(KEY_TOKEN, "");
        if (url.isEmpty() || token.isEmpty()) return false;
        HttpURLConnection conn = null;
        try {
            String full = url + (url.contains("?") ? "&" : "?") + "action=ingest&source=sms&token="
                    + URLEncoder.encode(token, "UTF-8");
            byte[] data = ("text=" + URLEncoder.encode(body, "UTF-8")).getBytes(StandardCharsets.UTF_8);
            conn = (HttpURLConnection) new URL(full).openConnection();
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(20000);
            conn.setReadTimeout(30000);
            conn.setDoOutput(true);
            conn.setInstanceFollowRedirects(true);
            conn.setRequestProperty("Content-Type", "application/x-www-form-urlencoded; charset=utf-8");
            try (OutputStream os = conn.getOutputStream()) { os.write(data); }
            int code = conn.getResponseCode();
            // Apps Script answers a POST with a redirect to the result; the message is already saved by then.
            return code < 500;
        } catch (Exception e) {
            return false;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    static synchronized void queue(Context c, String body) {
        try {
            JSONArray arr = new JSONArray(prefs(c).getString(KEY_PENDING, "[]"));
            if (arr.length() >= MAX_PENDING) arr.remove(0);
            arr.put(body);
            prefs(c).edit().putString(KEY_PENDING, arr.toString()).apply();
        } catch (Exception ignored) { }
    }

    /** Returns queued messages as a JSON array and empties the queue. */
    static synchronized String takePending(Context c) {
        String s = prefs(c).getString(KEY_PENDING, "[]");
        prefs(c).edit().putString(KEY_PENDING, "[]").apply();
        return s;
    }
}
