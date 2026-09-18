package de.qflash21.app;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.io.PrintWriter;
import java.io.StringWriter;

/**
 * Nativer QFLASH21-Fehlerbericht (keine Abhängigkeit zu androidx – bewusst rein
 * framework-basiert, damit diese Activity SELBST im Fehlerfall noch läuft).
 *
 * Zeigt dem Nutzer die deutsche Fehlermeldung + kompletten Stacktrace und bietet
 * „Fehler kopieren" (zum Einfügen in den Chat), „In Chrome öffnen" und
 * „App neu starten". Dadurch verschwindet die App nie stumm.
 */
public class CrashActivity extends Activity {

    public static final String EXTRA_TRACE = "trace";
    public static final String EXTRA_TITLE = "title";
    private static final String URL = "https://qflashk.vercel.app/";

    /** Öffentliche Einstiegs-Methode: startet den Fehlerbericht (aus Activity oder Application). */
    public static void show(Context ctx, Throwable t) {
        show(ctx, null, t);
    }

    public static void show(Context ctx, String title, Throwable t) {
        try {
            StringWriter sw = new StringWriter();
            if (t != null) {
                t.printStackTrace(new PrintWriter(sw));
            } else {
                sw.write("Unbekannter Fehler (keine Details verfügbar)");
            }
            Intent i = new Intent(ctx.getApplicationContext(), CrashActivity.class);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                    | Intent.FLAG_ACTIVITY_CLEAR_TOP
                    | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            i.putExtra(EXTRA_TRACE, sw.toString());
            if (title != null) i.putExtra(EXTRA_TITLE, title);
            ctx.getApplicationContext().startActivity(i);
        } catch (Throwable ignored) {
            // Letzter Rettungsversuch: nichts weiter tun – Original-Crash läuft weiter.
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        String rawTrace = getIntent().getStringExtra(EXTRA_TRACE);
        final String trace = (rawTrace == null || rawTrace.trim().isEmpty())
                ? "Unbekannter Fehler" : rawTrace;
        String rawTitle = getIntent().getStringExtra(EXTRA_TITLE);
        final String title = (rawTitle == null || rawTitle.trim().isEmpty())
                ? "QFLASH21 konnte nicht normal starten" : rawTitle;

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.parseColor("#09090B"));
        root.setPadding(dp(20), dp(24), dp(20), dp(20));

        TextView head = new TextView(this);
        head.setText("⚠ " + title);
        head.setTextColor(Color.parseColor("#FBBF24"));
        head.setTextSize(18);
        head.setTypeface(Typeface.DEFAULT_BOLD);
        root.addView(head, lp(-2, -2, 0, 0, 0, dp(8)));

        TextView sub = new TextView(this);
        sub.setText("Bitte Fehler kopieren und im Chat einfügen – so kann das Problem exakt behoben werden.\n\n"
                + deviceInfo());
        sub.setTextColor(Color.parseColor("#A1A1AA"));
        sub.setTextSize(14);
        root.addView(sub, lp(-2, -2, 0, 0, 0, dp(12)));

        TextView traceView = new TextView(this);
        traceView.setText(trace);
        traceView.setTextColor(Color.parseColor("#E4E4E7"));
        traceView.setTextSize(11);
        traceView.setTypeface(Typeface.MONOSPACE);
        traceView.setTextIsSelectable(true);

        ScrollView scroller = new ScrollView(this);
        scroller.addView(traceView);
        GradientDrawable box = new GradientDrawable();
        box.setColor(Color.parseColor("#18181B"));
        box.setCornerRadius(dp(8));
        scroller.setBackground(box);
        scroller.setPadding(dp(10), dp(10), dp(10), dp(10));
        root.addView(scroller, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        root.addView(button("📋  Fehler kopieren", v -> copy(trace)), mBtn());
        root.addView(button("🌐  In Chrome öffnen", v -> openInChrome()), mBtn());
        root.addView(button("🔄  App neu starten", v -> restartApp()), mBtn());
        root.addView(button("✖  Beenden", v -> finishAffinity()), mBtn());

        setContentView(root);
    }

    private String deviceInfo() {
        return "Gerät: " + Build.MANUFACTURER + " " + Build.MODEL
                + "\nAndroid: " + Build.VERSION.RELEASE + " (API " + Build.VERSION.SDK_INT + ")"
                + "\nQFLASH21: v" + versionName() + " (versionCode " + versionCode() + ")";
    }

    private String versionName() {
        try {
            return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (Throwable t) { return "?"; }
    }

    private int versionCode() {
        try {
            return getPackageManager().getPackageInfo(getPackageName(), 0).versionCode;
        } catch (Throwable t) { return -1; }
    }

    private void copy(String text) {
        try {
            ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
            cm.setPrimaryClip(ClipData.newPlainText("QFLASH21-Fehlerbericht", text));
            Toast.makeText(this, "Fehler kopiert – bitte in den Chat einfügen", Toast.LENGTH_LONG).show();
        } catch (Throwable t) {
            Toast.makeText(this, "Kopieren fehlgeschlagen", Toast.LENGTH_SHORT).show();
        }
    }

    private void openInChrome() {
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(URL));
            i.setPackage("com.android.chrome");
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
            return;
        } catch (Throwable ignored) {
            // Chrome nicht vorhanden → generischer Browser
        }
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(URL));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
        } catch (Throwable t) {
            Toast.makeText(this, "Kein Browser gefunden – Chrome bitte installieren", Toast.LENGTH_LONG).show();
        }
    }

    private void restartApp() {
        try {
            Intent i = getPackageManager().getLaunchIntentForPackage(getPackageName());
            if (i != null) {
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
                startActivity(i);
            }
            finishAffinity();
        } catch (Throwable t) {
            Toast.makeText(this, "Neustart fehlgeschlagen: " + t, Toast.LENGTH_LONG).show();
        }
    }

    private Button button(String label, View.OnClickListener onClick) {
        Button b = new Button(this);
        b.setText(label);
        b.setAllCaps(false);
        b.setTextColor(Color.parseColor("#FAFAFA"));
        b.setTextSize(15);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(Color.parseColor("#27272A"));
        bg.setCornerRadius(dp(10));
        b.setBackground(bg);
        b.setOnClickListener(onClick);
        return b;
    }

    private LinearLayout.LayoutParams mBtn() {
        return lp(-1, -2, 0, 0, 0, dp(10));
    }

    private LinearLayout.LayoutParams lp(int w, int h, int l, int t, int r, int b) {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(w, h);
        p.setMargins(l, t, r, b);
        p.gravity = Gravity.CENTER_HORIZONTAL;
        return p;
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }
}
