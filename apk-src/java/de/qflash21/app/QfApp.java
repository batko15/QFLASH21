package de.qflash21.app;

import android.app.Application;
import android.os.Process;

/**
 * Application-Klasse: installiert einen globalen Uncaught-Exception-Handler.
 *
 * Statt „App startet und schließt sofort" sieht der Nutzer immer den nativen
 * QFLASH21-Fehlerbericht (CrashActivity) mit kopierbarem Stacktrace – die
 * Grundvoraussetzung für Fern-Diagnose ohne Android-Studio.
 */
public class QfApp extends Application {

    private static volatile boolean sCrashScreenShown = false;

    @Override
    public void onCreate() {
        super.onCreate();
        final Thread.UncaughtExceptionHandler previous = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((thread, throwable) -> {
            if (sCrashScreenShown) {
                // Crash innerhalb des Fehlerberichts → Original-Handler, kein Loop.
                if (previous != null) previous.uncaughtException(thread, throwable);
                return;
            }
            sCrashScreenShown = true;
            CrashActivity.show(QfApp.this, throwable);
            // Prozess erst sauber beenden, NACHDEM der Fehlerbericht angezeigt werden konnte.
            new Thread(() -> {
                try {
                    Thread.sleep(700);
                } catch (InterruptedException ignored) {
                    // egal
                }
                Process.killProcess(Process.myPid());
                System.exit(10);
            }).start();
        });
    }
}
