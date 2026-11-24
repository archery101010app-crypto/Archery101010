package com.archery101010.app;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import androidx.annotation.Keep;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

/**
 * Foreground Location Service for active archery training sessions.
 * Keeps GNSS + step distance tracking alive on Android 14-16 (targetSdk 36)
 * when the phone screen is locked in the archer's pocket while walking to the target.
 */
@Keep
public class LocationTrackingService extends Service {
    public static final String ACTION_START = "com.archery101010.app.action.START_LOCATION_TRACKING";
    public static final String ACTION_STOP = "com.archery101010.app.action.STOP_LOCATION_TRACKING";

    private static final String CHANNEL_ID = "archery101010_session_location";
    private static final int NOTIFICATION_ID = 10101;

    public static void startIfPermitted(Context context) {
        if (context == null || !hasAnyLocationPermission(context)) return;
        try {
            Intent intent = new Intent(context, LocationTrackingService.class);
            intent.setAction(ACTION_START);
            ContextCompat.startForegroundService(context, intent);
        } catch (Exception ignored) {}
    }

    public static void stopSafely(Context context) {
        if (context == null) return;
        try {
            context.stopService(new Intent(context, LocationTrackingService.class));
        } catch (Exception ignored) {}
    }

    private static boolean hasAnyLocationPermission(Context context) {
        boolean fine = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION)
                == PackageManager.PERMISSION_GRANTED;
        boolean coarse = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION)
                == PackageManager.PERMISSION_GRANTED;
        return fine || coarse;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopForegroundCompat();
            stopSelf();
            return START_NOT_STICKY;
        }

        if (!hasAnyLocationPermission(this)) {
            stopSelf();
            return START_NOT_STICKY;
        }

        ensureNotificationChannel();
        Notification notification = buildOngoingNotification();

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(
                    NOTIFICATION_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
                );
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }
        } catch (SecurityException se) {
            stopSelf();
            return START_NOT_STICKY;
        } catch (Exception ex) {
            stopSelf();
            return START_NOT_STICKY;
        }

        return START_NOT_STICKY;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        stopForegroundCompat();
        stopSelf();
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        stopForegroundCompat();
        super.onDestroy();
    }

    private void stopForegroundCompat() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                stopForeground(STOP_FOREGROUND_REMOVE);
            } else {
                stopForeground(true);
            }
        } catch (Exception ignored) {}
    }

    private void ensureNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            try {
                NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
                if (nm == null) return;
                NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "Seguimiento de sesión",
                    NotificationManager.IMPORTANCE_LOW
                );
                channel.setDescription("Mantiene activa la medición de distancia durante la sesión de tiro");
                channel.setShowBadge(false);
                nm.createNotificationChannel(channel);
            } catch (Exception ignored) {}
        }
    }

    private Notification buildOngoingNotification() {
        Intent openAppIntent = new Intent(this, MainActivity.class);
        openAppIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            piFlags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent contentIntent = PendingIntent.getActivity(this, 0, openAppIntent, piFlags);

        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setContentTitle("ARCHERY 101010")
            .setContentText("Sesión activa · Distancia en curso")
            .setOngoing(true)
            .setSilent(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_WORKOUT)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setContentIntent(contentIntent)
            .build();
    }
}
