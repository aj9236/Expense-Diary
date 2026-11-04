package com.aj9236.expensediary;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.provider.Telephony;
import android.telephony.SmsMessage;

/** Receives each incoming SMS and passes bank-style messages to the owner's Google service. */
public class SmsReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (!Telephony.Sms.Intents.SMS_RECEIVED_ACTION.equals(intent.getAction())) return;
        SmsMessage[] parts = Telephony.Sms.Intents.getMessagesFromIntent(intent);
        if (parts == null || parts.length == 0) return;
        StringBuilder sb = new StringBuilder();
        for (SmsMessage m : parts) {
            if (m != null && m.getMessageBody() != null) sb.append(m.getMessageBody());
        }
        final String body = sb.toString();
        // Personal messages never leave the phone: only messages with an amount are sent.
        if (!SmsStore.looksLikeBankMessage(body)) return;

        final Context app = context.getApplicationContext();
        final PendingResult pending = goAsync();
        new Thread(() -> {
            try {
                if (!SmsStore.send(app, body)) SmsStore.queue(app, body);
            } finally {
                pending.finish();
            }
        }).start();
    }
}
